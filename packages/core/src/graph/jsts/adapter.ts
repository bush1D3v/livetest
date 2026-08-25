/**
 * Adapter de grafo de dependencias para JavaScript / TypeScript.
 *
 * Usa a API do compilador TypeScript em duas etapas:
 *
 * 1. {@link ts.preProcessFile} — scanner rapido (sem construir AST completa) que
 *    extrai todos os especificadores de `import`, `export ... from`,
 *    `require()` e `import()` com literal de string;
 * 2. {@link ts.resolveModuleName} — resolucao real do especificador para um
 *    arquivo em disco, respeitando `baseUrl`, `paths`, `index.*` e o mapeamento
 *    `./x.js -> ./x.ts` de projetos ESM/NodeNext.
 *
 * Imports que nao apontam para um arquivo dentro da raiz do projeto (pacotes de
 * `node_modules`, tipos ambientais) sao descartados: eles nao geram propagacao
 * de testes. Imports dinamicos com expressao nao literal sao detectados por
 * heuristica e reportados em `unresolved`, para que o log possa avisar que o
 * grafo pode estar incompleto naquele arquivo (secao 9 do PRD).
 *
 * @packageDocumentation
 */

import fs from 'node:fs';
import ts from 'typescript';

import type {
  DependencyGraphAdapter,
  FileImports,
  GraphAdapterContext,
} from '../../types/graph.js';
import { JS_EXTENSIONS } from '../../config/defaults.js';
import { dirname, isInside, normalizePath, toNative } from '../../util/paths.js';

/** `import(x)` / `require(x)` cujo argumento nao comeca por aspas. */
const DYNAMIC_EXPRESSION = /\b(?:import|require)\s*\(\s*(?!['"`])[^)\s]/;
/** Template com interpolacao — `import(\`./mod/${x}\`)` — tambem nao e literal. */
const DYNAMIC_TEMPLATE = /\b(?:import|require)\s*\(\s*`[^`]*\$\{/;

/** Opcoes de {@link createJsTsGraphAdapter}. */
export interface JsTsGraphAdapterOptions {
  /**
   * Caminho do `tsconfig.json`. Quando omitido, procura a partir da raiz.
   * Passe `null` para ignorar qualquer tsconfig e usar as opcoes padrao.
   */
  tsconfigPath?: string | null;
  /**
   * Scanner de imports. O padrao e o `ts.preProcessFile` do compilador.
   *
   * Substituir permite trocar o scanner por um mais rapido em projetos enormes
   * e, principalmente, exercitar em teste o caminho de degradacao — o
   * `preProcessFile` real e robusto demais para falhar sob demanda.
   */
  preProcessFile?: (text: string) => ts.PreProcessedFileInfo;
}

/** Le as opcoes de compilacao do projeto, com fallback seguro. */
export function loadCompilerOptions(
  root: string,
  explicitPath?: string | null,
): { options: ts.CompilerOptions; configPath: string | null } {
  const fallback: ts.CompilerOptions = {
    allowJs: true,
    checkJs: false,
    baseUrl: root,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    jsx: ts.JsxEmit.Preserve,
  };

  if (explicitPath === null) return { options: fallback, configPath: null };

  // O TypeScript normaliza caminhos com barra para frente em todas as
  // plataformas; passar um caminho nativo do Windows faz as APIs internas
  // dispararem "Debug Failure" ao comparar as duas formas.
  const configPath =
    explicitPath !== undefined
      ? normalizePath(explicitPath)
      : ts.findConfigFile(root, ts.sys.fileExists, 'tsconfig.json');

  if (!configPath || !ts.sys.fileExists(configPath)) {
    return { options: fallback, configPath: null };
  }

  const read = ts.readConfigFile(configPath, ts.sys.readFile);
  if (read.error || read.config === undefined) {
    return { options: fallback, configPath: null };
  }

  let parsed: ts.ParsedCommandLine;
  try {
    parsed = ts.parseJsonConfigFileContent(
      read.config,
      ts.sys,
      dirname(configPath),
      undefined,
      configPath,
    );
  } catch {
    // tsconfig sintaticamente valido mas semanticamente quebrado: seguimos com
    // as opcoes padrao em vez de derrubar o daemon.
    return { options: fallback, configPath: null };
  }

  return {
    options: { ...parsed.options, allowJs: true, noEmit: true },
    configPath,
  };
}

/**
 * Cria o adapter de grafo JS/TS.
 *
 * @example
 * ```ts
 * const adapter = createJsTsGraphAdapter({ root, logger, pythonPath, reportDegradation })();
 * const [entry] = await adapter.analyze(['/proj/src/header.ts']);
 * entry.imports; // ['/proj/src/login.ts']
 * ```
 */
export function createJsTsGraphAdapter(
  context: GraphAdapterContext,
  options: JsTsGraphAdapterOptions = {},
): DependencyGraphAdapter {
  const root = normalizePath(context.root);
  const logger = context.logger.child('js-ts');
  const preProcessFile =
    options.preProcessFile ??
    ((text: string) =>
      ts.preProcessFile(text, /* readImportFiles */ true, /* detectJavaScriptImports */ true));
  const { options: compilerOptions, configPath } = loadCompilerOptions(
    root,
    options.tsconfigPath,
  );
  if (configPath) logger.debug('usando tsconfig %s', configPath);

  // Cache de resolucao de modulos: a mesma dupla (especificador, diretorio)
  // aparece muitas vezes em um projeto real.
  const moduleCache = ts.createModuleResolutionCache(root, (fileName) => fileName, compilerOptions);

  /** Resolve um especificador para um arquivo do projeto, ou `null`. */
  function resolveSpecifier(specifier: string, containingFile: string): string | null {
    // Especificadores obviamente externos sao descartados sem tocar o disco.
    if (!specifier.startsWith('.') && !specifier.startsWith('/') && !compilerOptions.paths) {
      return null;
    }
    const resolved = ts.resolveModuleName(
      specifier,
      containingFile,
      compilerOptions,
      ts.sys,
      moduleCache,
    ).resolvedModule;

    if (!resolved) return null;
    const file = normalizePath(resolved.resolvedFileName);
    // O TypeScript marca como "biblioteca externa" tudo que resolve para dentro
    // de `node_modules`, seja por especificador nu, por caminho relativo ou por
    // alias de `paths` — uma unica checagem cobre os tres casos.
    if (resolved.isExternalLibraryImport) return null;
    if (!isInside(root, file)) return null;
    // Declaracoes de tipo nao possuem testes proprios nem geram execucao.
    if (file.endsWith('.d.ts')) return null;
    return file;
  }

  return {
    id: 'js-ts',
    extensions: JS_EXTENSIONS,

    async analyze(files: string[]): Promise<FileImports[]> {
      return files.map((file) => analyzeOne(file));
    },
  };

  function analyzeOne(file: string): FileImports {
    let text: string;
    try {
      text = fs.readFileSync(toNative(file), 'utf8');
    } catch (error) {
      // Arquivo apagado entre o evento do watcher e a analise: nao e um erro.
      logger.debug('nao foi possivel ler %s: %s', file, (error as Error).message);
      return { file, imports: [], unresolved: [] };
    }

    const imports = new Set<string>();
    const unresolved = new Set<string>();

    try {
      const preprocessed = preProcessFile(text);
      for (const reference of preprocessed.importedFiles) {
        const target = resolveSpecifier(reference.fileName, file);
        if (target) imports.add(target);
        else if (reference.fileName.startsWith('.')) unresolved.add(reference.fileName);
      }
    } catch (error) {
      // Erro de sintaxe nao derruba o daemon: o arquivo fica sem arestas.
      context.reportDegradation(
        `nao foi possivel analisar imports de ${file}`,
        error instanceof Error ? error.message : String(error),
      );
      return { file, imports: [], unresolved: [] };
    }

    if (DYNAMIC_EXPRESSION.test(text) || DYNAMIC_TEMPLATE.test(text)) {
      unresolved.add('<import dinamico com expressao nao literal>');
    }

    return { file, imports: [...imports], unresolved: [...unresolved] };
  }
}
