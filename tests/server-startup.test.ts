import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MAX_META_CALLS, createMetaServer, formatBudgetStartupLine } from '../server/meta-server';
import { ALLOWED_ORIGIN, countingFetch, rawRequest, withGuardedServer } from './helpers/paid-routes';

afterEach(() => vi.restoreAllMocks());

describe('startup budget report', () => {
  it('defaults to 1000 Meta calls', () => {
    expect(DEFAULT_MAX_META_CALLS).toBe(1000);
  });

  it('formats what is left, including when nothing is', () => {
    expect(formatBudgetStartupLine({ limit: 1000, used: 250, remaining: 750 }, '/x/budget.json')).toBe('Meta call budget: 750 of 1000 calls remaining (file: /x/budget.json)');
    expect(formatBudgetStartupLine({ limit: 1000, used: 1000, remaining: 0 }, '/x/budget.json')).toBe('Meta call budget: 0 of 1000 calls remaining (file: /x/budget.json) - paid routes will answer 429 until the file is deleted');
    expect(formatBudgetStartupLine({ limit: 5, used: 2, remaining: 3 }, undefined)).toBe('Meta call budget: 3 of 5 calls remaining (not persisted)');
  });

  it('is available from the server and follows real usage, also across a restart', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-startup-'));
    const file = join(directory, 'budget.json');
    try {
      const first = createMetaServer({ apiKey: 'x', fetchImpl: countingFetch(), metaCallBudgetFile: file });
      expect(first.metaCallBudget()).toEqual({ limit: DEFAULT_MAX_META_CALLS, used: 0, remaining: DEFAULT_MAX_META_CALLS });
      await withGuardedServer({ fetchImpl: countingFetch(), metaCallBudgetFile: file }, async (port) => {
        await rawRequest(port, { path: '/api/meta/text', headers: { 'content-type': 'application/json', origin: ALLOWED_ORIGIN }, body: { prompt: 'x' } });
      });
      const restarted = createMetaServer({ apiKey: 'x', fetchImpl: countingFetch(), metaCallBudgetFile: file });
      expect(restarted.metaCallBudget()).toEqual({ limit: DEFAULT_MAX_META_CALLS, used: 1, remaining: DEFAULT_MAX_META_CALLS - 1 });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});

describe('server/index.ts', () => {
  // Arranque a sério, sem chave Meta e em porta efémera: não há chamadas pagas possíveis.
  it('prints the remaining budget from the persisted file when it starts', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'unfold-index-'));
    const budgetFile = join(directory, 'meta-call-budget.json');
    writeFileSync(budgetFile, JSON.stringify({ limit: DEFAULT_MAX_META_CALLS, used: 250 }) + '\n');
    const env = { ...process.env, UNFOLD_STATE_DIR: directory, UNFOLD_BACKEND_PORT: '0' } as Record<string, string | undefined>;
    for (const key of ['MODEL_API_KEY', 'UNFOLD_ACCEPTANCE_MAX_META_CALLS', 'UNFOLD_ACCEPTANCE_BUDGET_FILE', 'UNFOLD_LOCAL_TOKEN_FILE', 'UNFOLD_MAX_CONCURRENT_META_CALLS']) delete env[key];
    const child = spawn(resolve('node_modules/.bin/tsx'), ['server/index.ts'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    try {
      const deadline = Date.now() + 15_000;
      while (!output.includes('Meta call budget:') && child.exitCode === null && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
      expect(output).toContain(`Meta call budget: ${DEFAULT_MAX_META_CALLS - 250} of ${DEFAULT_MAX_META_CALLS} calls remaining (file: ${budgetFile})`);
    } finally {
      child.kill('SIGTERM');
      await new Promise((r) => child.once('close', r));
      rmSync(directory, { recursive: true, force: true });
    }
  }, 20_000);
});
