/**
 * Mapeamento de arquivo-fonte para arquivo(s) de teste.
 *
 * A busca e feita por **templates de caminho**, e nao por convencao fixa, para
 * que projetos com layouts diferentes (`__tests__/`, `tests/` na raiz, teste ao
 * lado do fonte) funcionem sem configuracao. Cada template pode usar os tokens:
 *
 * | Token          | Significado                                                   |
 * | -------------- | ------------------------------------------------------------- |
 * | `{dir}`        | diretorio absoluto do arquivo-fonte                            |
 * | `{relDir}`     | diretorio relativo a raiz (ex.: `src/components`)              |
 * | `{relDirTail}` | `{relDir}` sem o primeiro segmento (ex.: `components`)         |
 * | `{name}`       | nome do arquivo sem diretorio nem extensao                     |
 * | `{ext}`        | extensao sem ponto, expandida sobre `testExtensions`           |
 *
 * Templates que nao comecam com `{dir}` sao resolvidos a partir da raiz do
 * projeto, o que cobre o layout `tests/` no topo do repositorio.
 *
 * @packageDocumentation
 */

import fs from 'node:fs';

import type { ResolvedConfig, RunnerConfig } from '../types/config.js';
import { createMatcher, type GlobMatcher } from '../util/glob.js';
import {
  basenameWithoutExt,
  dirname,
  extname,
  joinPosix,
  normalizePath,
  relativeToRoot,
  toNative,
} from '../util/paths.js';

/** Predicado de existencia de arquivo, injetavel em testes. */
export type FileExists = (path: string) => boolean;

/** Implementacao padrao apoiada no sistema de arquivos. */
export const defaultFileExists: FileExists = (p) => {
  try {
    return fs.statSync(toNative(p)).isFile();
  } catch {
    return false;
  }
};

/** Resultado do mapeamento de um arquivo-fonte. */
export interface TestMapping {
  /** Arquivo-fonte consultado. */
  sourceFile: string;
  /** Chave do runner responsavel, ou `null` se nenhum runner atende o arquivo. */
  runnerKey: string | null;
  /** Arquivos de teste existentes (absolutos, deduplicados). */
  testFiles: string[];
  /** `true` quando o proprio arquivo-fonte e um arquivo de teste. */
  isTestFile: boolean;
}

/** Mapeador de arquivos-fonte para arquivos de teste. */
export interface TestFileResolver {
  /** Chave do runner que atende o arquivo, na ordem de declaracao. */
  runnerKeyFor(file: string): string | null;
  /** Indica se o arquivo e, ele proprio, um teste. */
  isTestFile(file: string): boolean;
  /** Resolve os testes associados a um arquivo-fonte. */
  resolve(sourceFile: string): TestMapping;
  /** Expande os templates sem filtrar por existencia. Util para diagnostico. */
  candidatesFor(sourceFile: string): string[];
}

/** Opcoes de {@link createTestFileResolver}. */
export interface TestFileResolverOptions {
  config: ResolvedConfig;
  exists?: FileExists;
}

/**
 * Expande um template de caminho de teste.
 *
 * @param template - Template com os tokens documentados no modulo.
 * @param source - Arquivo-fonte absoluto.
 * @param root - Raiz do projeto.
 * @param ext - Extensao sem ponto usada para `{ext}`.
 *
 * @example
 * ```ts
 * expandTemplate('{dir}/{name}.test.{ext}', '/proj/src/login.ts', '/proj', 'ts');
 * // '/proj/src/login.test.ts'
 * ```
 */
export function expandTemplate(
  template: string,
  source: string,
  root: string,
  ext: string,
): string {
  const relDir = relativeToRoot(root, dirname(source));
  const normalizedRelDir = relDir === '.' ? '' : relDir;
  const relDirTail = normalizedRelDir.includes('/')
    ? normalizedRelDir.slice(normalizedRelDir.indexOf('/') + 1)
    : '';

  const expanded = template
    .replace(/\{dir\}/g, dirname(source))
    .replace(/\{relDirTail\}/g, relDirTail)
    .replace(/\{relDir\}/g, normalizedRelDir)
    .replace(/\{name\}/g, basenameWithoutExt(source))
    .replace(/\{ext\}/g, ext)
    // Tokens vazios deixam barras duplicadas: `tests//test_a.py`.
    .replace(/\/{2,}/g, '/');

  return expanded.startsWith('/') || /^[A-Za-z]:\//.test(expanded)
    ? normalizePath(expanded)
    : normalizePath(joinPosix(root, expanded));
}

/**
 * Cria um {@link TestFileResolver}.
 *
 * @example
 * ```ts
 * const resolver = createTestFileResolver({ config });
 * resolver.resolve('/proj/src/login.ts');
 * // { runnerKey: 'js', testFiles: ['/proj/src/login.test.ts'], isTestFile: false }
 * ```
 */
export function createTestFileResolver(options: TestFileResolverOptions): TestFileResolver {
  const { config } = options;
  const exists = options.exists ?? defaultFileExists;
  const root = config.root;

  /** Runners na ordem de declaracao, com seus matchers ja compilados. */
  const runners: Array<{
    key: string;
    runner: RunnerConfig;
    matchesSource: GlobMatcher;
    matchesTest: GlobMatcher;
  }> = Object.entries(config.runners).map(([key, runner]) => ({
    key,
    runner,
    matchesSource: createMatcher(runner.match, root),
    matchesTest: createMatcher(runner.testMatch ?? [], root),
  }));

  function entryFor(file: string) {
    return runners.find((entry) => entry.matchesSource(file));
  }

  function extensionsFor(runner: RunnerConfig, sourceFile: string): string[] {
    const own = extname(sourceFile).replace(/^\./, '');
    const configured = runner.testExtensions ?? [];
    // A extensao do proprio arquivo vem primeiro: e o palpite mais provavel.
    return [...new Set([own, ...configured].filter(Boolean))];
  }

  function candidates(sourceFile: string): string[] {
    const entry = entryFor(sourceFile);
    if (!entry) return [];
    const templates = entry.runner.testPatterns ?? [];
    const extensions = extensionsFor(entry.runner, sourceFile);

    const result: string[] = [];
    for (const template of templates) {
      // Templates sem `{ext}` sao expandidos uma unica vez.
      const usesExt = template.includes('{ext}');
      for (const ext of usesExt ? extensions : ['']) {
        const candidate = expandTemplate(template, sourceFile, root, ext);
        if (!result.includes(candidate)) result.push(candidate);
      }
    }
    return result;
  }

  return {
    runnerKeyFor: (file) => entryFor(normalizePath(file))?.key ?? null,

    isTestFile(file: string): boolean {
      const normalized = normalizePath(file);
      const entry = entryFor(normalized);
      return entry ? entry.matchesTest(normalized) : false;
    },

    candidatesFor: (sourceFile) => candidates(normalizePath(sourceFile)),

    resolve(sourceFile: string): TestMapping {
      const file = normalizePath(sourceFile);
      const entry = entryFor(file);
      if (!entry) {
        return { sourceFile: file, runnerKey: null, testFiles: [], isTestFile: false };
      }

      // Um arquivo de teste e o seu proprio teste: nao adianta procurar
      // `login.test.test.ts`.
      if (entry.matchesTest(file)) {
        return { sourceFile: file, runnerKey: entry.key, testFiles: [file], isTestFile: true };
      }

      const testFiles = candidates(file).filter((candidate) => exists(candidate));
      return { sourceFile: file, runnerKey: entry.key, testFiles, isTestFile: false };
    },
  };
}
