/**
 * Adapter de grafo de dependencias para Python.
 *
 * Combina {@link createAstPythonExtractor} (preciso, usa o modulo `ast` do
 * proprio interpretador) com {@link createRegexPythonExtractor} (fallback puro
 * em TypeScript). Se o interpretador nao estiver disponivel, o adapter degrada
 * **uma unica vez**, avisa pelo canal de eventos e segue funcionando — o daemon
 * nunca cai por falta de Python (NFR de robustez, secao 8 do PRD).
 *
 * @packageDocumentation
 */

import type {
  DependencyGraphAdapter,
  FileImports,
  GraphAdapterContext,
} from '../../types/graph.js';
import { PY_EXTENSIONS } from '../../config/defaults.js';
import { normalizePath } from '../../util/paths.js';
import {
  PythonUnavailableError,
  createAstPythonExtractor,
  createRegexPythonExtractor,
  type PythonImportExtractor,
} from './extractor.js';
import { resolveAllImports, type PythonResolveContext } from './resolve.js';

/** Opcoes de {@link createPythonGraphAdapter}. */
export interface PythonGraphAdapterOptions {
  /** Raizes onde procurar pacotes de topo. @defaultValue `['.', 'src']` */
  sourceRoots?: string[];
  /** Extrator explicito. Util em testes; desliga a logica de fallback. */
  extractor?: PythonImportExtractor;
  /** Caminho do script auxiliar `livetest_py_imports.py`. */
  scriptPath?: string;
}

/**
 * Cria o adapter de grafo Python.
 *
 * @example
 * ```ts
 * const adapter = createPythonGraphAdapter(context);
 * const [entry] = await adapter.analyze(['/proj/app/header.py']);
 * entry.imports; // ['/proj/app/login.py']
 * ```
 */
export function createPythonGraphAdapter(
  context: GraphAdapterContext,
  options: PythonGraphAdapterOptions = {},
): DependencyGraphAdapter {
  const root = normalizePath(context.root);
  const logger = context.logger.child('python');
  const resolveContext: PythonResolveContext = {
    root,
    sourceRoots: options.sourceRoots ?? ['.', 'src'],
  };

  const fixedExtractor = options.extractor ?? null;
  const astExtractor = fixedExtractor
    ? null
    : createAstPythonExtractor({
        pythonPath: context.pythonPath,
        logger,
        ...(options.scriptPath ? { scriptPath: options.scriptPath } : {}),
      });
  const regexExtractor = createRegexPythonExtractor();

  /** Vira `true` apos a primeira falha do interpretador. */
  let degraded = false;

  return {
    id: 'python',
    extensions: PY_EXTENSIONS,

    async analyze(files: string[]): Promise<FileImports[]> {
      if (files.length === 0) return [];

      const extracted = fixedExtractor
        ? await fixedExtractor.extract(files)
        : await extractWithFallback(files);

      return extracted.map((entry) => {
        const file = normalizePath(entry.file);
        if (entry.error) {
          logger.debug('imports de %s indisponiveis: %s', file, entry.error);
          return { file, imports: [], unresolved: [entry.error] };
        }
        const { resolved, unresolved } = resolveAllImports(entry.imports, file, resolveContext);
        return { file, imports: resolved, unresolved };
      });
    },

    dispose(): void {
      // Os extratores embutidos nao seguram recurso nenhum: cada lote e um
      // processo que ja encerrou quando `extract` resolve. So um extrator
      // injetado pode ter algo a liberar.
      options.extractor?.dispose?.();
    },
  };

  /** Tenta o extrator preciso e cai para o fallback na primeira falha. */
  async function extractWithFallback(files: string[]) {
    if (degraded || !astExtractor) return regexExtractor.extract(files);
    try {
      return await astExtractor.extract(files);
    } catch (error) {
      if (!(error instanceof PythonUnavailableError)) throw error;
      degraded = true;
      context.reportDegradation(
        `interpretador Python indisponivel ("${context.pythonPath}"); ` +
          'o grafo Python passa a usar analise por expressao regular, que e menos precisa',
        error.message,
      );
      return regexExtractor.extract(files);
    }
  }
}
