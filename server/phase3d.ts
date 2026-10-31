import { buildKinematicOperationPrompt, executeKinematicOperation, parseKinematicOperation } from '../src/ai-kinematic-experiment';
import { createPhase3DReferenceFixture, PHASE_3D_FIXTURE_MARKER } from '../src/phase3d-fixture';
import { requestMetaText } from '../src/meta';

async function main(): Promise<void> {
  if (process.env.NODE_ENV !== 'test' || process.env.UNFOLD_PHASE3D_FIXTURE_ONLY !== '1') {
    console.log(JSON.stringify({ status: 'BLOCKED', reason: `${PHASE_3D_FIXTURE_MARKER} requer NODE_ENV=test e UNFOLD_PHASE3D_FIXTURE_ONLY=1.` }));
    return;
  }
  if (!process.env.MODEL_API_KEY) {
    console.log(JSON.stringify({ status: 'BLOCKED', reason: 'MODEL_API_KEY não está configurada no processo do backend.' }));
    return;
  }
  const instruction = 'Aumenta o comprimento da manivela de 40 para 80 milímetros.';
  const { graph, assembly } = createPhase3DReferenceFixture();
  const prompt = buildKinematicOperationPrompt(instruction, assembly);
  const meta = await requestMetaText(prompt, process.env.MODEL_API_KEY);
  const parsed = parseKinematicOperation(meta.text);
  if (parsed.status === 'blocked') {
    console.log(JSON.stringify({ status: 'FAIL', meta: meta.log, issues: parsed.issues }));
    return;
  }
  const experiment = executeKinematicOperation(graph, assembly, parsed.operation);
  console.log(JSON.stringify({ status: experiment.status === 'executed' ? 'PASS' : 'FAIL', experiment, meta: meta.log }));
}

main().catch((error) => {
  console.log(JSON.stringify({ status: 'FAIL', error: error instanceof Error ? error.message : 'Falha na experiência.' }));
});
