import { validateTechnicalDocument, type TechnicalDocumentV1 } from './technical-document';

const DATABASE_NAME = 'unfold-spatial-source.v1';
const STORE_NAME = 'pending';
const SOURCE_KEY = 'last-image';

export type SpatialSourceImage = { blob: Blob; name: string; mimeType: string; technicalDocumentRef?: { documentId: string; sha256: string }; technicalDocument?: TechnicalDocumentV1 };

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

export async function saveSpatialSourceImage(file: File, technicalDocumentRef?: SpatialSourceImage['technicalDocumentRef'], technicalDocument?: TechnicalDocumentV1): Promise<void> {
  if (file.size <= 0 || file.size > 20 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) throw new Error('Imagem de origem inválida ou acima de 20 MiB.');
  if (technicalDocument) {
    validateTechnicalDocument(technicalDocument);
    if (!technicalDocumentRef || JSON.stringify(technicalDocument).length > 200_000) throw new Error('Documento aceite sem referência válida ou acima do limite.');
  }
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put({ blob: file, name: file.name, mimeType: file.type, ...(technicalDocumentRef ? { technicalDocumentRef } : {}), ...(technicalDocument ? { technicalDocument } : {}) } satisfies SpatialSourceImage, SOURCE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível guardar a imagem localmente.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('A gravação local foi cancelada.'));
    });
  } finally { database.close(); }
}

export async function readSpatialSourceImage(): Promise<{ file: File; technicalDocumentRef?: SpatialSourceImage['technicalDocumentRef']; technicalDocument?: TechnicalDocumentV1 } | undefined> {
  const database = await openDatabase();
  try {
    const entry = await new Promise<SpatialSourceImage | undefined>((resolve, reject) => {
      const request = database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(SOURCE_KEY);
      request.onsuccess = () => resolve(request.result as SpatialSourceImage | undefined);
      request.onerror = () => reject(request.error ?? new Error('Não foi possível recuperar a imagem local.'));
    });
    if (!entry || !(entry.blob instanceof Blob) || typeof entry.name !== 'string' || typeof entry.mimeType !== 'string' || entry.blob.size <= 0 || entry.blob.size > 20 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(entry.mimeType)) return undefined;
    if (entry.technicalDocumentRef && (!/^doc-[a-f0-9]{20}$/.test(entry.technicalDocumentRef.documentId) || !/^[a-f0-9]{64}$/.test(entry.technicalDocumentRef.sha256))) throw new Error('Referência ao documento técnico inválida.');
    if (entry.technicalDocument) {
      validateTechnicalDocument(entry.technicalDocument);
      if (!entry.technicalDocumentRef || JSON.stringify(entry.technicalDocument).length > 200_000) throw new Error('Documento técnico persistido inválido.');
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(entry.technicalDocument))));
      const sha256 = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('');
      if (entry.technicalDocumentRef.sha256 !== sha256 || entry.technicalDocumentRef.documentId !== `doc-${sha256.slice(0, 20)}`) throw new Error('Documento técnico não corresponde à referência guardada.');
    }
    return { file: new File([entry.blob], entry.name, { type: entry.mimeType }), ...(entry.technicalDocumentRef ? { technicalDocumentRef: entry.technicalDocumentRef } : {}), ...(entry.technicalDocument ? { technicalDocument: validateTechnicalDocument(entry.technicalDocument) } : {}) };
  } finally { database.close(); }
}

export async function clearSpatialSourceImage(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).delete(SOURCE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error ?? new Error('Não foi possível limpar a imagem temporária.'));
      transaction.onabort = () => reject(transaction.error ?? new Error('A limpeza local foi cancelada.'));
    });
  } finally { database.close(); }
}
