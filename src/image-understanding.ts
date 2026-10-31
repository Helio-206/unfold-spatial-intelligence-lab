import { validateMechanicalObservation, type MechanicalObservation } from './meta';

export const MECHANICAL_IMAGE_PROMPT = `Analisa esta imagem real de um mecanismo articulado de quatro barras. Responde apenas com JSON válido e exactamente com estes campos: elements, connections, dimensions, ambiguities, missingInformation. Em elements identifica apenas barras visíveis, juntas/articulações ou pivôs visíveis e elementos fixos visíveis. Para um pivô usa obrigatoriamente kind="joint"; os únicos valores permitidos para kind são exactamente "bar", "joint" e "fixed". Cada element tem obrigatoriamente id string, kind, label string, observed boolean true, evidence string e confidence numérica entre 0 e 1. Em connections regista apenas relações visíveis entre IDs observados, com from, to, relation string, observed boolean true e evidence string. Em dimensions inclui apenas dimensões explicitamente escritas ou marcadas na imagem, com label, value, observed boolean true e evidence string. Não infiras comprimentos, unidades, eixos, graus de liberdade, materiais, peças ocultas ou relações não confirmáveis. Tudo o que for ambíguo ou estiver ausente deve permanecer em ambiguities ou missingInformation como strings. Não uses outros campos, não uses outros tipos, não devolvas markdown nem texto fora do JSON.`;

function stripJsonFence(value: string): string {
  const trimmed = value.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1]?.trim() ?? trimmed;
}

export function parseMechanicalObservationText(text: string): MechanicalObservation {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripJsonFence(text));
  } catch {
    throw new Error('A Meta não devolveu JSON parseável.');
  }
  return validateMechanicalObservation(parsed);
}
