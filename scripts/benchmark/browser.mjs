import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

import { chromium } from 'playwright-core';

const KNOWN_CHROME_COMMANDS = ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser'];

function resolveCommand(command) {
  for (const directory of (process.env.PATH ?? '').split(delimiter).filter(Boolean)) {
    const candidate = join(directory, command);
    try {
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

export function systemChromiumPath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  for (const command of KNOWN_CHROME_COMMANDS) {
    const resolved = resolveCommand(command);
    if (resolved) return resolved;
  }
  throw new Error('Chrome/Chromium não encontrado. Defina CHROME_PATH ou instale um dos comandos suportados.');
}

export function launchSystemChromium(options = {}) {
  return chromium.launch({ executablePath: systemChromiumPath(), ...options });
}
