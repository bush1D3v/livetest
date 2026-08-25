/**
 * Extracao de imports de arquivos Python.
 *
 * Duas implementacoes sao oferecidas:
 *
 * - {@link createAstPythonExtractor} — invoca um script auxiliar que usa o
 *   modulo `ast` nativo (conforme secao 4.4 do PRD). E preciso e entende
 *   qualquer sintaxe que o proprio interpretador do projeto entenda. Um unico
 *   processo analisa o lote inteiro, evitando um spawn por arquivo;
 * - {@link createRegexPythonExtractor} — fallback puro em TypeScript, usado
 *   quando nao ha interpretador Python disponivel. Menos preciso, mas mantem a
 *   ferramenta util em vez de derrubar o daemon (NFR de robustez).
 *
 * @packageDocumentation
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { Logger } from '../../types/logging.js';
import { dirname, joinPosix, normalizePath, toNative } from '../../util/paths.js';

/** Um `import` encontrado em um arquivo Python. */
export interface PythonImportRecord {
  /** Modulo importado. `null` em `from . import x`. */
  module: string | null;
  /** Quantidade de pontos de um import relativo (`0` = absoluto). */
  level: number;
  /** Simbolos importados, que podem ser submodulos. */
  names: string[];
}

/** Resultado da analise de um arquivo Python. */
export interface PythonFileImports {
  file: string;
  imports: PythonImportRecord[];
  /** Mensagem quando o arquivo nao pode ser analisado. */
  error: string | null;
}

/** Estrategia de extracao de imports Python. */
export interface PythonImportExtractor {
  readonly id: string;
  extract(files: string[]): Promise<PythonFileImports[]>;
  dispose?(): void;
}

/** Caminho absoluto do script auxiliar `livetest_py_imports.py`. */
export function resolveHelperScriptPath(): string {
  // Vale tanto para `src/graph/python/` quanto para `dist/graph/python/`:
  // ambos estao a tres niveis da raiz do pacote.
  const here = dirname(normalizePath(fileURLToPath(import.meta.url)));
  return joinPosix(here, '..', '..', '..', 'assets', 'livetest_py_imports.py');
}

/** Opcoes de {@link createAstPythonExtractor}. */
export interface AstPythonExtractorOptions {
  /** Executavel do interpretador (ex.: `python3`, `.venv/bin/python`). */
  pythonPath: string;
  /** Caminho do script auxiliar. Default: o embutido no pacote. */
  scriptPath?: string;
  logger?: Logger;
  /** Timeout do processo auxiliar, em ms. */
  timeoutMs?: number;
}

/** Erro lancado quando o interpretador Python nao pode ser usado. */
export class PythonUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PythonUnavailableError';
  }
}

/**
 * Extrator baseado no modulo `ast` do proprio Python.
 *
 * @throws {@link PythonUnavailableError} de `extract` quando o interpretador
 * nao existe ou o script auxiliar falha. O chamador deve entao degradar para
 * {@link createRegexPythonExtractor}.
 */
export function createAstPythonExtractor(
  options: AstPythonExtractorOptions,
): PythonImportExtractor {
  const scriptPath = options.scriptPath ?? resolveHelperScriptPath();
  const timeoutMs = options.timeoutMs ?? 30_000;

  return {
    id: 'python-ast',
    async extract(files: string[]): Promise<PythonFileImports[]> {
      if (files.length === 0) return [];
      if (!fs.existsSync(toNative(scriptPath))) {
        throw new PythonUnavailableError(`script auxiliar ausente: ${scriptPath}`);
      }

      const payload = JSON.stringify({ files: files.map((file) => toNative(file)) });
      const raw = await runHelper(options.pythonPath, scriptPath, payload, timeoutMs);

      let parsed: { results?: unknown; error?: string | null };
      try {
        parsed = JSON.parse(raw) as { results?: unknown; error?: string | null };
      } catch {
        throw new PythonUnavailableError(
          `saida do script auxiliar nao e JSON: ${raw.slice(0, 200)}`,
        );
      }
      if (!Array.isArray(parsed.results)) {
        throw new PythonUnavailableError(parsed.error ?? 'script auxiliar nao retornou resultados');
      }

      return (parsed.results as Array<Record<string, unknown>>).map((entry) => ({
        file: normalizePath(String(entry['file'] ?? '')),
        imports: normalizeRecords(entry['imports']),
        error: typeof entry['error'] === 'string' ? entry['error'] : null,
      }));
    },
  };
}

function normalizeRecords(value: unknown): PythonImportRecord[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const record = item as Record<string, unknown>;
    const names = Array.isArray(record['names'])
      ? record['names'].filter((n): n is string => typeof n === 'string')
      : [];
    return {
      module: typeof record['module'] === 'string' ? record['module'] : null,
      level: typeof record['level'] === 'number' ? record['level'] : 0,
      names,
    };
  });
}

/** Executa o script auxiliar e devolve o stdout. */
function runHelper(
  pythonPath: string,
  scriptPath: string,
  stdinPayload: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(pythonPath, [toNative(scriptPath)], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    /**
     * Encerra a promessa uma unica vez.
     *
     * Os tres caminhos de saida competem entre si: uma falha de spawn e seguida
     * de um `close`, e o timeout pode disparar junto com qualquer um dos dois.
     */
    function settle(acao: () => void): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      acao();
    }

    const timer = setTimeout(() => {
      settle(() => {
        child.kill();
        reject(new PythonUnavailableError(`o script auxiliar excedeu ${timeoutMs} ms`));
      });
    }, timeoutMs);
    timer.unref?.();

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      settle(() =>
        reject(
          new PythonUnavailableError(
            `nao foi possivel executar "${pythonPath}": ${error.message}`,
          ),
        ),
      );
    });
    child.on('close', (code) => {
      settle(() => {
        if (code !== 0) {
          reject(
            new PythonUnavailableError(
              `script auxiliar saiu com codigo ${code}: ${stderr.trim().slice(0, 300)}`,
            ),
          );
          return;
        }
        resolve(stdout);
      });
    });

    child.stdin.on('error', () => {
      /* stdin fechado antes da escrita: o handler de 'error'/'close' resolve. */
    });
    child.stdin.end(stdinPayload, 'utf8');
  });
}

/** Ignora linhas que sao apenas comentario. */
const COMMENT_LINE = /^\s*#/;
/** `import a.b, c as d` */
const IMPORT_RE = /^\s*import\s+(.+?)\s*$/;
/** `from .pkg.mod import a, b` — grupo 1: pontos, 2: modulo, 3: nomes. */
const FROM_RE = /^\s*from\s+(\.*)([A-Za-z_][\w.]*)?\s+import\s+(.+?)\s*$/;
/** Delimitadores de string de tres aspas. */
const TRIPLE_QUOTE = /("""|''')/g;

/**
 * Extrator de fallback, puro em TypeScript.
 *
 * Limitacoes conhecidas, aceitaveis por ser um caminho de degradacao:
 * imports dentro de strings de tres aspas sao pulados por rastreio simples de
 * delimitadores, e continuacao de linha por contrabarra nao e suportada
 * (apenas a continuacao por parenteses, que e a forma idiomatica).
 */
export function createRegexPythonExtractor(): PythonImportExtractor {
  return {
    id: 'python-regex',
    async extract(files: string[]): Promise<PythonFileImports[]> {
      return files.map((file) => {
        let source: string;
        try {
          source = fs.readFileSync(toNative(file), 'utf8');
        } catch (error) {
          return { file, imports: [], error: `leitura falhou: ${(error as Error).message}` };
        }
        return { file, imports: parsePythonImports(source), error: null };
      });
    },
  };
}

/**
 * Faz o parse dos imports de um fonte Python usando expressoes regulares.
 * Exportado para permitir teste isolado da heuristica.
 */
export function parsePythonImports(source: string): PythonImportRecord[] {
  const records: PythonImportRecord[] = [];
  const lines = source.split(/\r?\n/);
  let insideTripleQuote = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i] as string;

    const quoteHits = line.match(TRIPLE_QUOTE);
    const startedInside = insideTripleQuote;
    if (quoteHits) insideTripleQuote = insideTripleQuote !== (quoteHits.length % 2 === 1);
    if (startedInside) continue;
    if (COMMENT_LINE.test(line)) continue;

    // Continuacao por parenteses: junta ate fechar.
    if (/\(\s*$/.test(line) || (line.includes('(') && !line.includes(')'))) {
      let joined = line;
      while (i + 1 < lines.length && !joined.includes(')')) {
        i++;
        joined += ` ${(lines[i] as string).trim()}`;
      }
      line = joined.replace(/[()]/g, ' ');
    }

    const fromMatch = FROM_RE.exec(line);
    if (fromMatch) {
      const [, dots = '', moduleName, rawNames = ''] = fromMatch;
      records.push({
        module: moduleName ?? null,
        level: dots.length,
        names: splitNames(rawNames),
      });
      continue;
    }

    const importMatch = IMPORT_RE.exec(line);
    if (importMatch) {
      for (const name of splitNames(importMatch[1] as string)) {
        records.push({ module: name, level: 0, names: [] });
      }
    }
  }
  return records;
}

/** Separa `a as b, c` em `['a', 'c']`, descartando `*`. */
function splitNames(raw: string): string[] {
  return raw
    .split(',')
    // `split` sempre devolve ao menos um elemento, entao o indice 0 existe.
    .map((part) => (part.split(/\s+as\s+/)[0] as string).trim())
    .filter((name) => name.length > 0 && name !== '*');
}
