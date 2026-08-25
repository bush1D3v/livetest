import { describe, expect, it, vi } from 'vitest';

import { createDependencyGraph } from '../../src/graph/graph.js';
import type { DependencyGraphAdapter, FileImports } from '../../src/types/graph.js';
import { createRecordingLogger } from '../helpers/logger.js';

/** Adapter em memoria: recebe o mapa `arquivo -> imports` ja resolvido. */
function fakeAdapter(
  edges: Record<string, string[]>,
  overrides: Partial<DependencyGraphAdapter> = {},
): DependencyGraphAdapter {
  return {
    id: 'fake',
    extensions: ['.ts'],
    analyze: async (files: string[]): Promise<FileImports[]> =>
      files.map((file) => ({ file, imports: edges[file] ?? [], unresolved: [] })),
    ...overrides,
  };
}

describe('createDependencyGraph', () => {
  it('indexa arestas nos dois sentidos', async () => {
    const graph = createDependencyGraph({
      adapters: [fakeAdapter({ '/header.ts': ['/login.ts'] })],
    });
    await graph.index(['/header.ts', '/login.ts']);

    expect(graph.dependenciesOf('/header.ts')).toEqual(['/login.ts']);
    expect(graph.dependentsOf('/login.ts')).toEqual(['/header.ts']);
    expect(graph.size()).toBe(2);
  });

  it('ignora arquivos sem adapter para a extensao', async () => {
    const graph = createDependencyGraph({ adapters: [fakeAdapter({})] });
    await graph.index(['/a.ts', '/b.py']);
    expect(graph.dependenciesOf('/b.py')).toEqual([]);
    expect(graph.files()).toContain('/b.py');
  });

  it('descarta auto-import', async () => {
    const graph = createDependencyGraph({ adapters: [fakeAdapter({ '/a.ts': ['/a.ts'] })] });
    await graph.index(['/a.ts']);
    expect(graph.dependenciesOf('/a.ts')).toEqual([]);
  });

  describe('impactedBy', () => {
    // login <- header <- layout <- page ; login <- footer
    const edges = {
      '/header.ts': ['/login.ts'],
      '/footer.ts': ['/login.ts'],
      '/layout.ts': ['/header.ts'],
      '/page.ts': ['/layout.ts'],
    };
    const all = ['/login.ts', '/header.ts', '/footer.ts', '/layout.ts', '/page.ts'];

    async function build() {
      const graph = createDependencyGraph({ adapters: [fakeAdapter(edges)] });
      await graph.index(all);
      return graph;
    }

    it('profundidade 0 devolve apenas o proprio arquivo', async () => {
      const graph = await build();
      expect(graph.impactedBy("/login.ts", 0)).toEqual([
        { file: '/login.ts', depth: 0, chain: ['/login.ts'] },
      ]);
    });

    it('profundidade 1 devolve os importadores diretos', async () => {
      const graph = await build();
      const files = graph.impactedBy('/login.ts', 1).map((i) => i.file);
      expect(files.sort()).toEqual(['/footer.ts', '/header.ts', '/login.ts']);
    });

    it('profundidade infinita percorre a cadeia completa', async () => {
      const graph = await build();
      const files = graph.impactedBy('/login.ts', Number.POSITIVE_INFINITY).map((i) => i.file);
      expect(files.sort()).toEqual(all.slice().sort());
    });

    it('registra a cadeia de importacao para explicar a selecao', async () => {
      const graph = await build();
      const page = graph
        .impactedBy('/login.ts', Number.POSITIVE_INFINITY)
        .find((i) => i.file === '/page.ts');
      expect(page).toEqual({
        file: '/page.ts',
        depth: 3,
        chain: ['/login.ts', '/header.ts', '/layout.ts', '/page.ts'],
      });
    });

    it('profundidade intermediaria limita os saltos', async () => {
      const graph = await build();
      const files = graph.impactedBy('/login.ts', 2).map((i) => i.file);
      expect(files).toContain('/layout.ts');
      expect(files).not.toContain('/page.ts');
    });

    it('nao entra em loop com dependencia circular', async () => {
      const graph = createDependencyGraph({
        adapters: [fakeAdapter({ '/a.ts': ['/b.ts'], '/b.ts': ['/a.ts'] })],
      });
      await graph.index(['/a.ts', '/b.ts']);
      const files = graph.impactedBy('/a.ts', Number.POSITIVE_INFINITY).map((i) => i.file);
      expect(files).toEqual(['/a.ts', '/b.ts']);
    });

    it('devolve so o proprio arquivo quando ninguem o importa', async () => {
      const graph = await build();
      expect(graph.impactedBy('/page.ts', Number.POSITIVE_INFINITY)).toHaveLength(1);
    });
  });
});

describe('DependencyGraph — atualizacao incremental', () => {
  it('update refaz as arestas do arquivo alterado', async () => {
    const edges: Record<string, string[]> = { '/header.ts': ['/login.ts'] };
    const graph = createDependencyGraph({ adapters: [fakeAdapter(edges)] });
    await graph.index(['/header.ts', '/login.ts', '/session.ts']);
    expect(graph.dependentsOf('/login.ts')).toEqual(['/header.ts']);

    // O arquivo passa a importar outro modulo.
    edges['/header.ts'] = ['/session.ts'];
    await graph.update(['/header.ts']);

    expect(graph.dependentsOf('/login.ts')).toEqual([]);
    expect(graph.dependentsOf('/session.ts')).toEqual(['/header.ts']);
  });

  it('update indexa um arquivo novo', async () => {
    const graph = createDependencyGraph({ adapters: [fakeAdapter({ '/novo.ts': ['/a.ts'] })] });
    await graph.index(['/a.ts']);
    await graph.update(['/novo.ts']);
    expect(graph.dependentsOf('/a.ts')).toEqual(['/novo.ts']);
  });

  it('remove apaga o arquivo e suas arestas de saida', async () => {
    const graph = createDependencyGraph({ adapters: [fakeAdapter({ '/header.ts': ['/login.ts'] })] });
    await graph.index(['/header.ts', '/login.ts']);
    graph.remove('/header.ts');
    expect(graph.files()).toEqual(['/login.ts']);
    expect(graph.dependentsOf('/login.ts')).toEqual([]);
  });

  it('index substitui completamente o estado anterior', async () => {
    const graph = createDependencyGraph({ adapters: [fakeAdapter({ '/a.ts': ['/b.ts'] })] });
    await graph.index(['/a.ts', '/b.ts']);
    await graph.index(['/c.ts']);
    expect(graph.files()).toEqual(['/c.ts']);
  });
});

describe('DependencyGraph — robustez', () => {
  it('guarda os especificadores nao resolvidos', async () => {
    const adapter = fakeAdapter({}, {
      analyze: async (files) =>
        files.map((file) => ({ file, imports: [], unresolved: ['./dinamico'] })),
    });
    const graph = createDependencyGraph({ adapters: [adapter] });
    await graph.index(['/a.ts']);
    expect(graph.unresolvedOf('/a.ts')).toEqual(['./dinamico']);
  });

  it('limpa os nao resolvidos quando a analise passa a ter sucesso', async () => {
    let failing = true;
    const adapter = fakeAdapter({}, {
      analyze: async (files) =>
        files.map((file) => ({ file, imports: [], unresolved: failing ? ['./x'] : [] })),
    });
    const graph = createDependencyGraph({ adapters: [adapter] });
    await graph.index(['/a.ts']);
    failing = false;
    await graph.update(['/a.ts']);
    expect(graph.unresolvedOf('/a.ts')).toEqual([]);
  });

  it('degrada com seguranca quando o adapter lanca', async () => {
    const { logger, lines } = createRecordingLogger('warn');
    const adapter = fakeAdapter({}, {
      analyze: async () => {
        throw new Error('parser explodiu');
      },
    });
    const graph = createDependencyGraph({ adapters: [adapter], logger });
    await expect(graph.index(['/a.ts', '/b.ts'])).resolves.toBeUndefined();
    expect(graph.dependenciesOf('/a.ts')).toEqual([]);
    expect(lines.join(' ')).toContain('parser explodiu');
  });

  it('roteia cada extensao para o seu adapter', async () => {
    const ts = fakeAdapter({ '/a.ts': ['/b.ts'] });
    const py = { ...fakeAdapter({ '/a.py': ['/b.py'] }), id: 'py', extensions: ['.py'] };
    const graph = createDependencyGraph({ adapters: [ts, py] });
    await graph.index(['/a.ts', '/a.py']);
    expect(graph.dependenciesOf('/a.ts')).toEqual(['/b.ts']);
    expect(graph.dependenciesOf('/a.py')).toEqual(['/b.py']);
  });

  it('dispose libera cada adapter uma unica vez', async () => {
    const dispose = vi.fn();
    const adapter = fakeAdapter({}, { extensions: ['.ts', '.tsx'], dispose });
    const graph = createDependencyGraph({ adapters: [adapter] });
    await graph.index(['/a.ts']);
    await graph.dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(graph.size()).toBe(0);
  });
});

describe('DependencyGraph — cobertura de bordas', () => {
  it('aceita entrada de um arquivo que nao estava no lote analisado', async () => {
    // Um adapter pode devolver entradas extras (um arquivo gerado, por exemplo);
    // o grafo precisa indexa-las sem assumir que ja existiam.
    const adapter = fakeAdapter({}, {
      analyze: async (files) => [
        ...files.map((file) => ({ file, imports: [], unresolved: [] })),
        { file: '/extra.ts', imports: ['/a.ts'], unresolved: [] },
      ],
    });
    const graph = createDependencyGraph({ adapters: [adapter] });
    await graph.index(['/a.ts']);

    expect(graph.dependentsOf('/a.ts')).toEqual(['/extra.ts']);
    expect(graph.dependenciesOf('/extra.ts')).toEqual(['/a.ts']);
  });

  it('degrada quando o adapter lanca algo que nao e Error', async () => {
    const { logger, lines } = createRecordingLogger('warn');
    const adapter = fakeAdapter({}, {
      analyze: async () => {
        throw 'string solta';
      },
    });
    const graph = createDependencyGraph({ adapters: [adapter], logger });
    await graph.index(['/a.ts']);
    expect(lines.join(' ')).toContain('string solta');
  });

  it('descarta a entrada reversa vazia ao remover o arquivo', async () => {
    const edges: Record<string, string[]> = { '/header.ts': ['/login.ts'] };
    const graph = createDependencyGraph({ adapters: [fakeAdapter(edges)] });
    await graph.index(['/header.ts', '/login.ts']);

    // header deixa de importar login: o conjunto reverso de login fica vazio.
    edges['/header.ts'] = [];
    await graph.update(['/header.ts']);
    graph.remove('/login.ts');

    expect(graph.files()).toEqual(['/header.ts']);
    expect(graph.dependentsOf('/login.ts')).toEqual([]);
  });

  it('mantem a entrada reversa quando ainda ha importadores', async () => {
    const graph = createDependencyGraph({ adapters: [fakeAdapter({ '/header.ts': ['/login.ts'] })] });
    await graph.index(['/header.ts', '/login.ts']);
    graph.remove('/login.ts');
    // O arquivo saiu do indice, mas quem o importava continua registrado.
    expect(graph.dependentsOf('/login.ts')).toEqual(['/header.ts']);
  });

  it('devolve listas vazias para arquivos desconhecidos', () => {
    const graph = createDependencyGraph({ adapters: [] });
    expect(graph.dependenciesOf('/nunca-visto.ts')).toEqual([]);
    expect(graph.dependentsOf('/nunca-visto.ts')).toEqual([]);
    expect(graph.unresolvedOf('/nunca-visto.ts')).toEqual([]);
  });

  it('dispose sem adapters nao lanca', async () => {
    const graph = createDependencyGraph({ adapters: [] });
    await expect(graph.dispose()).resolves.toBeUndefined();
  });

  it('usa o logger silencioso quando nenhum e informado', async () => {
    const graph = createDependencyGraph({ adapters: [fakeAdapter({})] });
    await expect(graph.index(['/a.ts'])).resolves.toBeUndefined();
  });

  it('adapter sem dispose nao quebra o encerramento', async () => {
    const graph = createDependencyGraph({ adapters: [fakeAdapter({})] });
    await graph.index(['/a.ts']);
    await expect(graph.dispose()).resolves.toBeUndefined();
  });
});

describe('DependencyGraph — degradacao observavel', () => {
  it('notifica o callback quando um adapter falha', async () => {
    const avisos: Array<{ message: string; detail: string | null }> = [];
    const adapter = fakeAdapter({}, {
      analyze: async () => {
        throw new Error('parser explodiu');
      },
    });
    const graph = createDependencyGraph({
      adapters: [adapter],
      onDegradation: (message, detail) => avisos.push({ message, detail }),
    });
    await graph.index(['/a.ts', '/b.ts']);

    expect(avisos).toHaveLength(1);
    expect(avisos[0]?.message).toContain('"fake" falhou ao analisar 2 arquivo(s)');
    expect(avisos[0]?.message).toContain('parser explodiu');
    expect(avisos[0]?.detail).toContain('Error');
  });

  it('nao traz pilha quando o adapter lanca algo que nao e Error', async () => {
    const avisos: Array<{ message: string; detail: string | null }> = [];
    const adapter = fakeAdapter({}, {
      analyze: async () => {
        throw 'string solta';
      },
    });
    const graph = createDependencyGraph({
      adapters: [adapter],
      onDegradation: (message, detail) => avisos.push({ message, detail }),
    });
    await graph.index(['/a.ts']);

    expect(avisos[0]?.detail).toBeNull();
  });
});

describe('DependencyGraph — erro sem pilha', () => {
  it('reporta detalhe nulo quando o Error nao tem stack', async () => {
    const avisos: Array<string | null> = [];
    const semPilha = new Error('sem pilha');
    delete (semPilha as { stack?: string }).stack;

    const adapter = fakeAdapter({}, {
      analyze: async () => {
        throw semPilha;
      },
    });
    const graph = createDependencyGraph({
      adapters: [adapter],
      onDegradation: (_message, detail) => avisos.push(detail),
    });
    await graph.index(['/a.ts']);

    expect(avisos).toEqual([null]);
  });
});
