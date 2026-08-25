/**
 * Conversao de `.gitignore` para globs do `picomatch`.
 *
 * Suportamos o subconjunto do formato que importa para um watcher: comentarios,
 * linhas em branco, ancoragem por barra inicial e marcacao de diretorio por
 * barra final. **Negacoes (`!padrao`) nao sao suportadas** e sao reportadas como
 * aviso — respeitar negacao exigiria avaliar as regras em ordem, o que o
 * `picomatch` nao faz em uma unica passada.
 *
 * @packageDocumentation
 */

import fs from 'node:fs';
import path from 'node:path';

/** Resultado da conversao de um `.gitignore`. */
export interface GitignoreResult {
  /** Globs prontos para `picomatch`, relativos a raiz. */
  patterns: string[];
  /** Avisos sobre regras nao suportadas. */
  warnings: string[];
}

/**
 * Converte o conteudo de um `.gitignore` em globs.
 *
 * @example
 * ```ts
 * parseGitignore('dist/\n/build\n*.log');
 * // patterns: ['**\/dist/**', 'build', 'build/**', '**\/*.log', '**\/*.log/**']
 * ```
 */
export function parseGitignore(content: string): GitignoreResult {
  const patterns: string[] = [];
  const warnings: string[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    if (line.startsWith('!')) {
      warnings.push(`Negacao de .gitignore ignorada (nao suportada): "${line}"`);
      continue;
    }

    const isDirOnly = line.endsWith('/');
    const isAnchored = line.startsWith('/');
    const body = line.replace(/^\/+/, '').replace(/\/+$/, '');
    if (body === '') continue;

    const base = isAnchored ? body : `**/${body}`;
    if (isDirOnly) {
      patterns.push(`${base}/**`);
    } else {
      patterns.push(base);
      patterns.push(`${base}/**`);
    }
  }

  return { patterns, warnings };
}

/**
 * Le e converte o `.gitignore` da raiz, se existir.
 *
 * @param root - Raiz do projeto (caminho nativo ou POSIX).
 * @returns Globs vazios quando o arquivo nao existe ou nao pode ser lido.
 */
export function readGitignore(root: string): GitignoreResult {
  const file = path.join(root, '.gitignore');
  try {
    return parseGitignore(fs.readFileSync(file, 'utf8'));
  } catch {
    return { patterns: [], warnings: [] };
  }
}
