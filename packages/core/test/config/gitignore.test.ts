import { describe, expect, it } from 'vitest';

import { parseGitignore, readGitignore } from '../../src/config/gitignore.js';
import { createTempProject } from '../helpers/tmp.js';

describe('parseGitignore', () => {
  it('ignora linhas em branco e comentarios', () => {
    expect(parseGitignore('\n# comentario\n  \n').patterns).toEqual([]);
  });

  it('trata barra final como diretorio', () => {
    expect(parseGitignore('dist/').patterns).toEqual(['**/dist/**']);
  });

  it('ancora padroes que comecam com barra', () => {
    expect(parseGitignore('/build').patterns).toEqual(['build', 'build/**']);
  });

  it('gera as duas formas para padroes soltos', () => {
    expect(parseGitignore('*.log').patterns).toEqual(['**/*.log', '**/*.log/**']);
  });

  it('combina ancoragem e diretorio', () => {
    expect(parseGitignore('/coverage/').patterns).toEqual(['coverage/**']);
  });

  it('avisa sobre negacoes em vez de aplica-las', () => {
    const result = parseGitignore('!importante.log');
    expect(result.patterns).toEqual([]);
    expect(result.warnings[0]).toContain('Negacao');
  });

  it('descarta uma linha composta apenas de barras', () => {
    expect(parseGitignore('/').patterns).toEqual([]);
  });
});

describe('readGitignore', () => {
  it('le o arquivo da raiz', () => {
    const project = createTempProject({ '.gitignore': 'dist/\n' });
    try {
      expect(readGitignore(project.root).patterns).toEqual(['**/dist/**']);
    } finally {
      project.cleanup();
    }
  });

  it('devolve vazio quando o arquivo nao existe', () => {
    const project = createTempProject();
    try {
      expect(readGitignore(project.root)).toEqual({ patterns: [], warnings: [] });
    } finally {
      project.cleanup();
    }
  });
});
