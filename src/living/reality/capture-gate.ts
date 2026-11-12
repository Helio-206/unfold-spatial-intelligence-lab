/**
 * The decision BEFORE a reconstruction is built: is the capture enough for a result worth trusting, and if not, what exactly is missing and how to get it.
 * Three levels. `blocked`: nothing credible can be built (the existing refusals). `low-confidence`: a reconstruction can be built, but one or more things that
 * the measured behaviour depends on are missing; the person must see them and acknowledge them, and the acknowledgement is written into the evidence. `ok`.
 * The system never moves from a low-confidence capture to a reconstruction silently.
 */
import type { IntakeResult } from './intake';

export type GateItem = { code: string; severity: 'blocking' | 'low-confidence' | 'info'; what: string; how: string };
export type CaptureGate = { level: 'blocked' | 'low-confidence' | 'ok'; items: GateItem[] };

const FROM_CAPTURE: Record<string, { severity: GateItem['severity']; how?: string }> = {
  OBJECT_CUT_OFF: { severity: 'blocking' }, TOO_FEW_VIEWS: { severity: 'blocking' },
  ANGULAR_GAP: { severity: 'low-confidence' }, NO_ELEVATION_VARIETY: { severity: 'low-confidence' }, BLURRY: { severity: 'low-confidence' }, OVEREXPOSED: { severity: 'low-confidence' }, UNDEREXPOSED: { severity: 'low-confidence' },
  LOW_RESOLUTION: { severity: 'low-confidence' }, UNEVEN_FRAMING: { severity: 'low-confidence' }, REDUNDANT_VIEW: { severity: 'info' },
};

export function assessGate(input: { result: IntakeResult | null; mode: 'turntable' | 'orbit' | 'video' | 'drawing'; elevationDeclared: boolean }): CaptureGate {
  const { result, mode } = input, items: GateItem[] = [];
  if (!result) return { level: 'blocked', items: [{ code: 'NOT_ANALYSED', severity: 'blocking', what: 'As vistas ainda não foram analisadas.', how: 'Carregue em «Analisar vistas».' }] };
  if (!result.evidence) return { level: 'blocked', items: result.refusals.map((r) => ({ code: r.code, severity: 'blocking' as const, what: r.detail, how: 'Corrija a vista indicada (use «Ajustar contorno» ou uma imagem com fundo liso) e volte a analisar.' })) };
  if (mode === 'drawing') return { level: 'ok', items };
  for (const q of result.capture?.issues ?? []) { const m = FROM_CAPTURE[q.code]; if (m) items.push({ code: q.code, severity: m.severity, what: q.message, how: q.advice }); }
  const n = result.views.length, unconfirmed = result.views.filter((v) => v.maskSource === 'automatic' && v.maskMethod !== undefined && !v.maskMethod.startsWith('classical-colour')).length;
  if (unconfirmed > 0) items.push({ code: 'OUTLINES_UNCONFIRMED', severity: 'low-confidence', what: `${unconfirmed} de ${n} contornos são propostas automáticas por confirmar. Nos testes com fundos reais mais de metade destas propostas estava errada.`, how: 'Em cada vista veja o contorno e carregue em «O contorno está certo», ou corrija-o em «Ajustar contorno».' });
  if (mode !== 'orbit' && n < 8) items.push({ code: 'FEW_VIEWS_ASSUMED_POSES', severity: 'low-confidence', what: `${n} vistas com ângulos assumidos (passos iguais): a configuração medida no benchmark tem 8 ou mais.`, how: 'Acrescente vistas até 8 ou mais, ou indique os ângulos reais.' });
  if (!input.elevationDeclared) items.push({ code: 'ELEVATION_UNKNOWN', severity: 'low-confidence', what: 'A elevação da câmara não foi indicada: assume-se 0° e o topo e a base do objecto ficam mal restringidos.', how: 'Indique a elevação aproximada, e fotografe também de cima (≈ 40°).' });
  const cam = result.evidence.camera;
  if (cam?.source === 'estimated') items.push({ code: 'CAMERA_ESTIMATED', severity: 'info', what: `Campo de visão ESTIMADO em ${cam.fovDeg}° a partir das próprias vistas (não medido nem lido do EXIF).`, how: 'Se souber o campo de visão real da câmara (ou o equivalente em mm), indique-o: passa a constar como indicado por si.' });
  else if (cam?.source === 'declared') items.push({ code: 'CAMERA_DECLARED', severity: 'info', what: `Campo de visão ${cam.fovDeg}° indicado por si; não foi verificado.`, how: 'Uma calibração real (xadrez ou EXIF fiável) permitiria verificá-lo.' });
  else items.push({ code: 'CAMERA_UNCALIBRATED', severity: 'info', what: 'Campo de visão e distância da câmara são desconhecidos: a reconstrução assume projecção ortográfica (erro medido ≤ 3,5% da diagonal até 65° de campo de visão em renders; não validado em fotografias).', how: 'Para reduzir o erro: afaste-se e use zoom (câmara longa), ou indique o campo de visão quando houver calibração.' });
  const level = items.some((i) => i.severity === 'blocking') ? 'blocked' : items.some((i) => i.severity === 'low-confidence') ? 'low-confidence' : 'ok';
  return { level, items };
}
