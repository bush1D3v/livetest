/**
 * Resolucao de imports Python para caminhos de arquivo.
 *
 * Reimplementa a parte da maquinaria de import do Python que importa para um
 * grafo de dependencias de projeto:
 *
 * - **imports relativos** (`from . import x`, `from ..pkg.mod import Y`) —
 *   a base e o diretorio do arquivo, subindo `level - 1` niveis;
 * - **imports absolutos** (`import pacote.modulo`) — testados contra uma lista
 *   de raizes de codigo: a raiz do pacote do proprio arquivo (subindo enquanto
 *   houver `__init__.py`), a raiz do projeto e diretorios de fonte comuns;
 * - **`from pacote import submodulo`** — cada nome importado tambem e testado
 *   como submodulo, ja que em Python nao ha como distinguir sintaticamente um
 *   simbolo de um modulo.
 *
 * Imports que nao resolvem para um arquivo do projeto sao simplesmente
 * descartados quando absolutos (sao stdlib ou pacotes instalados) e reportados
 * em `unresolved` quando relativos — um relativo que nao resolve indica grafo
 * incompleto e merece aviso.
 *
 * @packageDocumentation
 */

import fs from 'node:fs';

import { dirname, isInside, joinPosix, normalizePath, toNative } from '../../util/paths.js';
import type { PythonImportRecord } from './extractor.js';

/** Predicado de existencia de arquivo, injetavel em testes. */
export type FileExists = (path: string) => boolean;

/** Implementacao padrao apoiada no sistema de arquivos real. */
export const fsExists: FileExists = (p) => {
  try {
    return fs.statSync(toNative(p)).isFile();
  } catch {
    return false;
  }
};

/** Contexto de resolucao. */
export interface PythonResolveContext {
  /** Raiz absoluta do projeto. */
  root: string;
  /**
   * Raizes adicionais onde procurar pacotes de topo, relativas a raiz.
   * @defaultValue `['.', 'src']`
   */
  sourceRoots?: string[];
  exists?: FileExists;
}

/** Resultado da resolucao de um registro de import. */
export interface PythonResolution {
  /** Arquivos do projeto encontrados. */
  resolved: string[];
  /** Descricao dos imports relativos que nao resolveram. */
  unresolved: string[];
}

/** Extensoes testadas, na ordem de preferencia do interpretador. */
const MODULE_SUFFIXES = ['.py', '.pyi'] as const;

/**
 * Encontra a raiz do pacote que contem `file`: sobe enquanto o diretorio tiver
 * `__init__.py`, sem ultrapassar `root`.
 *
 * @example
 * ```ts
 * // /proj/app/core/db.py, com /proj/app/__init__.py e /proj/app/core/__init__.py
 * findPackageRoot('/proj/app/core/db.py', '/proj'); // '/proj'
 * ```
 */
export function findPackageRoot(file: string, root: string, exists: FileExists = fsExists): string {
  let dir = dirname(normalizePath(file));
  const limit = normalizePath(root);
  while (isInside(limit, dir) && dir !== limit && exists(joinPosix(dir, '__init__.py'))) {
    dir = dirname(dir);
  }
  return dir;
}

/** Tenta `<base>.py`, `<base>.pyi` e `<base>/__init__.py`. */
function resolveModulePath(base: string, exists: FileExists): string | null {
  for (const suffix of MODULE_SUFFIXES) {
    const candidate = `${base}${suffix}`;
    if (exists(candidate)) return candidate;
  }
  const initFile = joinPosix(base, '__init__.py');
  if (exists(initFile)) return initFile;
  return null;
}

/**
 * Resolve um unico registro de import para os arquivos do projeto que ele
 * alcanca.
 *
 * @param record - Import extraido do arquivo.
 * @param containingFile - Arquivo absoluto que contem o import.
 * @param context - Raiz do projeto e predicado de existencia.
 *
 * @example
 * ```ts
 * resolveImportRecord(
 *   { module: 'auth.login', level: 0, names: ['authenticate'] },
 *   '/proj/app/header.py',
 *   { root: '/proj' },
 * );
 * // { resolved: ['/proj/auth/login.py'], unresolved: [] }
 * ```
 */
export function resolveImportRecord(
  record: PythonImportRecord,
  containingFile: string,
  context: PythonResolveContext,
): PythonResolution {
  const exists = context.exists ?? fsExists;
  const root = normalizePath(context.root);
  const file = normalizePath(containingFile);
  const moduleParts = record.module ? record.module.split('.').filter(Boolean) : [];

  const bases = record.level > 0
    ? relativeBase(file, record.level, root)
    : absoluteBases(file, root, context.sourceRoots, exists);

  const resolved = new Set<string>();

  for (const base of bases) {
    const target = moduleParts.length > 0 ? joinPosix(base, ...moduleParts) : base;

    const moduleFile = resolveModulePath(target, exists);
    if (moduleFile && isInside(root, moduleFile)) resolved.add(moduleFile);

    // `from pacote import x` — `x` pode ser um submodulo.
    for (const name of record.names) {
      const nameFile = resolveModulePath(joinPosix(target, name), exists);
      if (nameFile && isInside(root, nameFile)) resolved.add(nameFile);
    }

    // A primeira raiz que resolve algo vence, como no `sys.path` do Python.
    if (resolved.size > 0) break;
  }

  const unresolved =
    resolved.size === 0 && record.level > 0
      ? [`${'.'.repeat(record.level)}${record.module ?? ''}`]
      : [];

  return { resolved: [...resolved], unresolved };
}

/** Base de um import relativo: o diretorio do arquivo, subindo `level - 1`. */
function relativeBase(file: string, level: number, root: string): string[] {
  let base = dirname(file);
  for (let i = 1; i < level; i++) {
    const parent = dirname(base);
    if (parent === base || !isInside(root, parent)) break;
    base = parent;
  }
  return [base];
}

/** Raizes candidatas para um import absoluto, na ordem de preferencia. */
function absoluteBases(
  file: string,
  root: string,
  sourceRoots: string[] | undefined,
  exists: FileExists,
): string[] {
  const bases = new Set<string>();
  bases.add(findPackageRoot(file, root, exists));
  for (const relative of sourceRoots ?? ['.', 'src']) {
    bases.add(relative === '.' ? root : joinPosix(root, relative));
  }
  bases.add(root);
  return [...bases];
}

/**
 * Resolve todos os imports de um arquivo de uma vez.
 *
 * @returns Arquivos importados (deduplicados) e imports relativos que falharam.
 */
export function resolveAllImports(
  records: readonly PythonImportRecord[],
  containingFile: string,
  context: PythonResolveContext,
): PythonResolution {
  const resolved = new Set<string>();
  const unresolved = new Set<string>();

  for (const record of records) {
    const result = resolveImportRecord(record, containingFile, context);
    for (const item of result.resolved) resolved.add(item);
    for (const item of result.unresolved) unresolved.add(item);
  }

  resolved.delete(normalizePath(containingFile));
  return { resolved: [...resolved], unresolved: [...unresolved] };
}
