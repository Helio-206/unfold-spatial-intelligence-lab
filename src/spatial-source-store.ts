import { validateTechnicalDocument, type TechnicalDocumentV1 } from './technical-document';

const DATABASE_NAME = 'unfold-spatial-source.v1';
const STORE_NAME = 'pending';
const LEGACY_SOURCE_KEY = 'last-image';
const HANDOFF_KEY = 'unfold-spatial-source-handoff.v1';

export type SpatialSourceImage = { blob: Blob; name: string; mimeType: string; sourceImageSha256?: string; technicalDocumentRef?: { documentId: string; sha256: string }; technicalDocument?: TechnicalDocumentV1 };

async function sha256(blob: Blob): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()));
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function sourceKey(imageSha256: string, documentId?: string): string {
  if (!/^[a-f0-9]{64}$/i.test(imageSha256)) throw new Error('SPATIAL_SOURCE_IMAGE_HASH_INVALID');
  if (documentId !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/.test(documentId)) throw new Error('SPATIAL_SOURCE_DOCUMENT_ID_INVALID');
  return `source:${imageSha256.toLowerCase()}:${documentId ? encodeURIComponent(documentId) : 'none'}`;
}

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('Armazenamento local do browser indisponível.'));
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Não foi possível abrir o armazenamento local.'));
    request.onblocked = () => reject(new Error('Actualização do armazenamento local bloqueada por outra janela.'));
  });
}

export async function saveSpatialSourceImage(file: File, technicalDocumentRef?: SpatialSourceImage['technicalDocumentRef'], technicalDocument?: TechnicalDocumentV1, options: { sourceImageSha256?: string; setHandoff?: boolean } = {}): Promise<string> {
  if (file.size <= 0 || file.size > 20 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Imagem de origem inválida ou acima de 20 MiB.');
  const imageSha256 = options.sourceImageSha256 ?? await sha256(file);
  const documentId = technicalDocumentRef?.documentId;
  const key = sourceKey(imageSha256, documentId);
  if (technicalDocument) {
    validateTechnicalDocument(technicalDocument);
    if (!technicalDocumentRef || JSON.stringify(technicalDocument).length > 200_000) throw new Error('Documento aceite sem referência válida ou acima do limite.');
  }
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({ blob: file, name: file.name, mimeType: file.type, sourceImageSha256: imageSha256, ...(technicalDocumentRef ? { technicalDocumentRef } : {}), ...(technicalDocument ? { technicalDocument } : {}) } satisfies SpatialSourceImage, key);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível guardar a imagem localmente.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('A gravação local foi cancelada.'));
    });
  } finally { database.close(); }
  if (options.setHandoff !== false) sessionStorage.setItem(HANDOFF_KEY, `${imageSha256.toLowerCase()}|${documentId ?? ''}`);
  return imageSha256.toLowerCase();
}

export function setSpatialSourceImageHandoff(imageSha256: string, documentId?: string): void {
  sourceKey(imageSha256, documentId);
  sessionStorage.setItem(HANDOFF_KEY, `${imageSha256.toLowerCase()}|${documentId ?? ''}`);
}

export async function readSpatialSourceImage(imageSha256?: string, documentId?: string): Promise<{ file: File; sourceImageSha256?: string; technicalDocumentRef?: SpatialSourceImage['technicalDocumentRef']; technicalDocument?: TechnicalDocumentV1 } | undefined> {
  const database = await openDatabase();
  try {
    const handoff = imageSha256 ? undefined : sessionStorage.getItem(HANDOFF_KEY) ?? undefined;
    const [handoffHash, handoffDocumentId] = handoff ? handoff.split('|', 2) : [];
    const selectedHash = imageSha256 ?? handoffHash;
    const selectedDocumentId = documentId ?? handoffDocumentId ?? undefined;
    const key = selectedHash ? sourceKey(selectedHash, selectedDocumentId || undefined) : LEGACY_SOURCE_KEY;
    const entry = await new Promise<SpatialSourceImage | undefined>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(key);
      request.onsuccess = () => resolve(request.result as SpatialSourceImage | undefined);
      request.onerror = () => reject(request.error ?? new Error('Não foi possível recuperar a imagem local.'));
    });
    if (!entry || !(entry.blob instanceof Blob) || typeof entry.name !== 'string' || typeof entry.mimeType !== 'string' || entry.blob.size <= 0 || entry.blob.size > 20 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(entry.mimeType)) return undefined;
    if (entry.sourceImageSha256) {
      if (entry.sourceImageSha256.toLowerCase() !== (await sha256(entry.blob)).toLowerCase()) throw new Error('SPATIAL_SOURCE_IMAGE_HASH_MISMATCH');
      if (selectedHash && entry.sourceImageSha256.toLowerCase() !== selectedHash.toLowerCase()) throw new Error('SPATIAL_SOURCE_IMAGE_IDENTITY_MISMATCH');
      if (selectedDocumentId && entry.technicalDocumentRef?.documentId !== selectedDocumentId) throw new Error('SPATIAL_SOURCE_DOCUMENT_IDENTITY_MISMATCH');
    }
    if (entry.technicalDocumentRef && (!/^doc-[a-f0-9]{20}$/.test(entry.technicalDocumentRef.documentId) || !/^[a-f0-9]{64}$/.test(entry.technicalDocumentRef.sha256))) throw new Error('Referência ao documento técnico inválida.');
    if (entry.technicalDocument) {
      validateTechnicalDocument(entry.technicalDocument);
      if (!entry.technicalDocumentRef || JSON.stringify(entry.technicalDocument).length > 200_000) throw new Error('Documento técnico persistido inválido.');
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(entry.technicalDocument))));
      const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
      if (entry.technicalDocumentRef.sha256 !== sha256 || entry.technicalDocumentRef.documentId !== `doc-${sha256.slice(0, 20)}`) throw new Error('Documento técnico não corresponde à referência guardada.');
    }
    return { file: new File([entry.blob], entry.name, { type: entry.mimeType }), ...(entry.sourceImageSha256 ? { sourceImageSha256: entry.sourceImageSha256 } : {}), ...(entry.technicalDocumentRef ? { technicalDocumentRef: entry.technicalDocumentRef } : {}), ...(entry.technicalDocument ? { technicalDocument: validateTechnicalDocument(entry.technicalDocument) } : {}) };
  } finally { database.close(); }
}

export async function clearSpatialSourceImage(): Promise<void> {
  sessionStorage.removeItem(HANDOFF_KEY);
}
