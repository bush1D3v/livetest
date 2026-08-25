/** Utilitarios de teste da CLI. */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import type { OutputChannel } from '../../src/context.js';

/** Canal de saida que acumula as linhas em memoria. */
export interface CapturedOutput extends OutputChannel {
  /** Linhas escritas no stdout. */
  stdout: string[];
  /** Linhas escritas no stderr. */
  stderr: string[];
  /** stdout concatenado. */
  outText(): string;
  /** stderr concatenado. */
  errText(): string;
}

/** Cria um canal de saida capturado. */
export function captureOutput(): CapturedOutput {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    stdout,
    stderr,
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
    outText: () => stdout.join('\n'),
    errText: () => stderr.join('\n'),
  };
}

/** Projeto temporario para os testes da CLI. */
export interface TempProject {
  root: string;
  path(relative: string): string;
  write(relative: string, content: string): void;
  cleanup(): void;
}

/** Cria um projeto temporario com os arquivos informados. */
export function createTempProject(files: Record<string, string> = {}): TempProject {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livetest-cli-'));
  const root = fs.realpathSync(dir).replace(/\\/g, '/');

  const project: TempProject = {
    root,
    path: (relative) => path.join(root, relative).replace(/\\/g, '/'),
    write(relative, content) {
      const target = path.join(root, relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf8');
    },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };

  for (const [relative, content] of Object.entries(files)) project.write(relative, content);
  return project;
}

/**
 * Projeto de exemplo com a cadeia `login -> header/footer -> layout`.
 *
 * Usa o adapter `command` apontando para o proprio Node: os testes da CLI
 * exercitam o fluxo completo sem depender de vitest ou pytest instalados.
 */
export function createDemoProject(script = 'process.exit(0)'): TempProject {
  return createTempProject({
    'livetest.config.json': JSON.stringify({
      watch: ['src/**/*.ts'],
      useGitignore: false,
      dependencyDepth: { default: 'direct', overrides: { 'src/login.ts': 'transitive' } },
      debounce: { idleMs: 30, maxBatchWindowMs: 200 },
      runners: {
        js: {
          adapter: 'command',
          command: process.execPath,
          args: ['-e', script],
          match: ['src/**/*.ts'],
          testMatch: ['**/*.test.ts'],
          testPatterns: ['{dir}/{name}.test.{ext}'],
          testExtensions: ['ts'],
          graph: 'js-ts',
        },
      },
      output: { stdout: false, logFile: null, statusFile: '.livetest/status.json' },
      server: { enabled: false },
      logLevel: 'silent',
    }),
    'src/login.ts': 'export const login = () => true;\n',
    'src/login.test.ts': 'import { login } from "./login";\n',
    'src/header.ts': 'import { login } from "./login";\nexport const header = login;\n',
    'src/header.test.ts': 'import { header } from "./header";\n',
    'src/footer.ts': 'import { login } from "./login";\nexport const footer = login;\n',
    'src/footer.test.ts': 'import { footer } from "./footer";\n',
    'src/layout.ts': 'import { header } from "./header";\nexport const layout = header;\n',
    'src/layout.test.ts': 'import { layout } from "./layout";\n',
    'src/orfao.ts': 'export const orfao = 1;\n',
  });
}
