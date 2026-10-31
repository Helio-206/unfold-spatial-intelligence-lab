import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { executeDesignSandboxOperation, validateDesignSandboxRequest, type DesignSandboxModel } from '../src/design-sandbox';
import { parseKinematicOperation, type KinematicOperation } from '../src/ai-kinematic-experiment';
import { BACKEND_CONTRACT } from './meta-server';

const DEFAULT_PORT = 8791;
const MAX_BODY_BYTES = 16 * 1024;
let requestNumber = 0;

function writeJson(response: ServerResponse, status: number, body: unknown): void {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.writeHead(status);
  response.end(JSON.stringify(body));
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Payload excede o limite do mock E2E.'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function operationFromInstruction(instruction: string): KinematicOperation | undefined {
  const match = instruction.match(/(\d+(?:\.\d+)?)\s*(?:mm|milímetros?)/i);
  if (!match) return undefined;
  return { schema: 'kinematic_operation.v1', action: 'update_length', componentId: 'crank', newValue: Number(match[1]), unit: 'mm' };
}

export function createPhase4CMockServer(): Server {
  return createServer(async (request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }
    if (request.method === 'GET' && request.url === '/api/health') {
      writeJson(response, 200, { status: 'ok', service: 'unfold-phase4c-e2e-mock', contract: BACKEND_CONTRACT });
      return;
    }
    if (request.method !== 'POST' || request.url !== '/api/experiments/preview') {
      writeJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Rota não encontrada.' } });
      return;
    }
    try {
      const body = JSON.parse(await readBody(request)) as unknown;
      const validation = validateDesignSandboxRequest(body);
      if (validation.status === 'invalid') {
        writeJson(response, 400, { error: { code: 'INVALID_DESIGN_SANDBOX', message: 'O desenho sandbox não passou a validação.', issues: validation.issues } });
        return;
      }
      const operation = operationFromInstruction(validation.model.instruction);
      if (!operation) {
        writeJson(response, 422, { error: { code: 'MALFORMED_OPERATION', message: 'O mock não encontrou uma operação de comprimento na instrução.' }, meta: { httpStatus: 200, requestId: 'phase4c-mock-malformed' } });
        return;
      }
      if (validation.model.instruction.includes('[slow]')) await new Promise((resolve) => setTimeout(resolve, 400));
      const parsed = parseKinematicOperation(JSON.stringify(operation));
      if (parsed.status === 'blocked') {
        writeJson(response, 422, { error: { code: 'MALFORMED_OPERATION', message: 'Operação simulada inválida.' }, meta: { httpStatus: 200, requestId: 'phase4c-mock-malformed' } });
        return;
      }
      const executed = executeDesignSandboxOperation(validation.model as DesignSandboxModel, parsed.operation);
      if (executed.status === 'blocked') {
        writeJson(response, 422, { error: { code: 'OPERATION_BLOCKED', message: 'A operação não foi autorizada ou executada.', issues: executed.issues }, meta: { httpStatus: 200, requestId: `phase4c-mock-${++requestNumber}` } });
        return;
      }
      writeJson(response, 200, {
        ...executed,
        meta: { status: 'success', httpStatus: 200, latencyMs: 0, usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, requestId: `phase4c-mock-${++requestNumber}` },
      });
    } catch (error) {
      writeJson(response, 400, { error: { code: 'INVALID_JSON', message: error instanceof Error ? error.message : 'JSON inválido.' } });
    }
  });
}

if (process.env.UNFOLD_PHASE4C_MOCK === '1') {
  const port = Number(process.env.UNFOLD_BACKEND_PORT ?? DEFAULT_PORT);
  createPhase4CMockServer().listen(port, '127.0.0.1', () => {
    console.info(`UNFOLD phase4c E2E mock listening on http://127.0.0.1:${port}`);
  });
}
