/**
 * Utilitarios de diretorio temporario para os testes de integracao com o
 * sistema de arquivos.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { normalizePath } from '../../src/util/paths.js';

/** Projeto temporario criado em disco para um teste. */
export interface TempProject {
  /** Raiz absoluta em formato POSIX. */
  root: string;
  /** Cria (ou sobrescreve) um arquivo, criando os diretorios necessarios. */
  write(relativePath: string, content: string): string;
  /** Caminho absoluto POSIX de um arquivo do projeto. */
  path(relativePath: string): string;
  /** Remove o diretorio inteiro. */
  cleanup(): void;
}

/**
 * Cria um projeto temporario com os arquivos informados.
 *
 * @param files - Mapa `caminho relativo -> conteudo`.
 */
export function createTempProject(files: Record<string, string> = {}): TempProject {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'livetest-'));
  // No macOS o tmpdir e um symlink (/var -> /private/var); resolver evita que
  // comparacoes de caminho falhem.
  const root = normalizePath(fs.realpathSync(dir));

  const project: TempProject = {
    root,
    path: (relativePath) => normalizePath(path.join(root, relativePath)),
    write(relativePath, content) {
      const target = path.join(root, relativePath);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content, 'utf8');
      return normalizePath(target);
    },
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };

  for (const [relativePath, content] of Object.entries(files)) {
    project.write(relativePath, content);
  }
  return project;
}
