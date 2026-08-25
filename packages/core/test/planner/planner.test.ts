import { beforeAll, afterAll, describe, expect, it } from 'vitest';

import { resolveConfig } from '../../src/config/load.js';
import { createDependencyGraph, type DependencyGraph } from '../../src/graph/graph.js';
import { createJsTsGraphAdapter } from '../../src/graph/jsts/adapter.js';
import { planBatch, summarizeReason } from '../../src/planner/planner.js';
import { createTestFileResolver } from '../../src/testmap/resolver.js';
import type { LiveTestUserConfig } from '../../src/types/config.js';
import { relativeToRoot } from '../../src/util/paths.js';
import { createRecordingLogger } from '../helpers/logger.js';
import { createTempProject, type TempProject } from '../helpers/tmp.js';

/**
 * Projeto do caso de aceitacao da secao 10 do PRD:
 * `login.ts` e importado por `header.ts` e por `footer.ts`;
 * `layout.ts` importa `header.ts` (segundo nivel).
 */
const FILES: Record<string, string> = {
  'src/login.ts': 'export const login = () => true;',
  'src/login.test.ts': 'import { login } from "./login";',
  'src/header.ts': 'import { login } from "./login";\nexport const header = login;',
  'src/header.test.ts': 'import { header } from "./header";',
  'src/footer.ts': 'import { login } from "./login";\nexport const footer = login;',
  'src/footer.test.ts': 'import { footer } from "./footer";',
  'src/layout.ts': 'import { header } from "./header";\nexport const layout = header;',
  'src/layout.test.ts': 'import { layout } from "./layout";',
  'src/orfao.ts': 'export const orfao = 1;',
  'README.md': '# projeto',
};

let project: TempProject;
let graph: DependencyGraph;

beforeAll(async () => {
  project = createTempProject(FILES);
  const adapter = createJsTsGraphAdapter({
    root: project.root,
    logger: createRecordingLogger('warn').logger,
    pythonPath: 'python',
    reportDegradation: () => {},
  });
  graph = createDependencyGraph({ adapters: [adapter] });
  await graph.index(
    Object.keys(FILES)
      .filter((f) => f.endsWith('.ts'))
      .map((f) => project.path(f)),
  );
});

afterAll(() => project.cleanup());

function planFor(changed: string[], user: LiveTestUserConfig = {}) {
  const { config } = resolveConfig({ useGitignore: false, ...user }, { root: project.root });
  const resolver = createTestFileResolver({ config });
  return planBatch({ config, graph, resolver, changedFiles: changed.map((f) => project.path(f)) });
}

/** Caminhos relativos, para asserts legiveis. */
const rel = (files: string[]): string[] => files.map((f) => relativeToRoot(project.root, f)).sort();

describe('planBatch — profundidade', () => {
  it('self roda apenas o teste do arquivo alterado', () => {
    const plan = planFor(['src/login.ts'], { dependencyDepth: { default: 'self' } });
    expect(rel(plan.entries[0]?.testFiles ?? [])).toEqual(['src/login.test.ts']);
  });

  it('direct inclui os testes dos importadores diretos', () => {
    const plan = planFor(['src/login.ts'], { dependencyDepth: { default: 'direct' } });
    expect(rel(plan.entries[0]?.testFiles ?? [])).toEqual([
      'src/footer.test.ts',
      'src/header.test.ts',
      'src/login.test.ts',
    ]);
  });

  it('transitive percorre a cadeia completa', () => {
    const plan = planFor(['src/login.ts'], { dependencyDepth: { default: 'transitive' } });
    expect(rel(plan.entries[0]?.testFiles ?? [])).toEqual([
      'src/footer.test.ts',
      'src/header.test.ts',
      'src/layout.test.ts',
      'src/login.test.ts',
    ]);
  });

  it('profundidade numerica limita os saltos', () => {
    const plan = planFor(['src/login.ts'], { dependencyDepth: { default: 1 } });
    expect(rel(plan.entries[0]?.testFiles ?? [])).not.toContain('src/layout.test.ts');
  });

  it('cobre o criterio de sucesso do PRD: overrides distintos por arquivo', () => {
    const user: LiveTestUserConfig = {
      dependencyDepth: {
        default: 'self',
        overrides: { 'src/login.ts': 'transitive', 'src/header.ts': 'self' },
      },
    };
    expect(rel(planFor(['src/login.ts'], user).entries[0]?.testFiles ?? [])).toEqual([
      'src/footer.test.ts',
      'src/header.test.ts',
      'src/layout.test.ts',
      'src/login.test.ts',
    ]);
    expect(rel(planFor(['src/header.ts'], user).entries[0]?.testFiles ?? [])).toEqual([
      'src/header.test.ts',
    ]);
  });
});

describe('planBatch — transparencia', () => {
  it('marca o proprio arquivo como "changed" e os demais como "importer"', () => {
    const plan = planFor(['src/login.ts'], { dependencyDepth: { default: 'direct' } });
    const reasons = plan.entries[0]?.reasons ?? {};
    expect(reasons[project.path('src/login.test.ts')]?.[0]?.kind).toBe('changed');
    expect(reasons[project.path('src/header.test.ts')]?.[0]).toMatchObject({
      kind: 'importer',
      depth: 1,
      sourceFile: project.path('src/header.ts'),
      changedFile: project.path('src/login.ts'),
    });
  });

  it('registra a cadeia completa de importacao', () => {
    const plan = planFor(['src/login.ts'], { dependencyDepth: { default: 'transitive' } });
    const chain = plan.entries[0]?.reasons[project.path('src/layout.test.ts')]?.[0]?.chain ?? [];
    expect(rel(chain)).toEqual(['src/header.ts', 'src/layout.ts', 'src/login.ts']);
  });

  it('acumula um motivo por arquivo alterado quando o lote tem varios', () => {
    const plan = planFor(['src/header.ts', 'src/footer.ts'], {
      dependencyDepth: { default: 'self' },
    });
    expect(rel(plan.entries[0]?.testFiles ?? [])).toEqual([
      'src/footer.test.ts',
      'src/header.test.ts',
    ]);
  });

  it('explica arquivos sem teste correspondente', () => {
    const plan = planFor(['src/orfao.ts']);
    expect(plan.entries).toHaveLength(0);
    expect(plan.unmatched).toHaveLength(1);
    expect(plan.unmatched[0]?.reason).toContain('nenhum arquivo de teste encontrado');
    expect(plan.unmatched[0]?.reason).toContain('src/orfao.test.ts');
  });

  it('explica arquivos sem runner', () => {
    const plan = planFor(['README.md']);
    expect(plan.unmatched[0]?.reason).toContain('nenhum runner configurado');
  });
});

describe('planBatch — agrupamento', () => {
  it('agrupa por runner e ordena os arquivos de teste', () => {
    const plan = planFor(['src/login.ts'], { dependencyDepth: { default: 'direct' } });
    expect(plan.entries).toHaveLength(1);
    expect(plan.entries[0]?.runnerKey).toBe('js');
    expect(plan.entries[0]?.testFiles).toEqual([...(plan.entries[0]?.testFiles ?? [])].sort());
  });

  it('conta os arquivos de teste distintos', () => {
    const plan = planFor(['src/login.ts'], { dependencyDepth: { default: 'direct' } });
    expect(plan.totalTestFiles).toBe(3);
  });

  it('nao duplica um teste alcancado por dois caminhos', () => {
    const plan = planFor(['src/login.ts', 'src/header.ts'], {
      dependencyDepth: { default: 'direct' },
    });
    const headerTest = project.path('src/header.test.ts');
    expect(plan.entries[0]?.testFiles.filter((f) => f === headerTest)).toHaveLength(1);
    // Mas guarda os dois motivos, para explicar a selecao.
    expect(plan.entries[0]?.reasons[headerTest]?.length).toBe(2);
  });

  it('devolve plano vazio para lote vazio', () => {
    const plan = planFor([]);
    expect(plan).toEqual({ entries: [], unmatched: [], totalTestFiles: 0 });
  });

  it('trata um arquivo de teste alterado como seu proprio teste', () => {
    const plan = planFor(['src/login.test.ts'], { dependencyDepth: { default: 'self' } });
    expect(rel(plan.entries[0]?.testFiles ?? [])).toEqual(['src/login.test.ts']);
  });
});

describe('summarizeReason', () => {
  it('descreve o arquivo alterado', () => {
    const summary = summarizeReason(
      {
        kind: 'changed',
        changedFile: project.path('src/login.ts'),
        sourceFile: project.path('src/login.ts'),
        depth: 0,
        chain: [project.path('src/login.ts')],
      },
      project.root,
    );
    expect(summary).toBe('rodou porque src/login.ts foi alterado');
  });

  it('descreve um importador direto', () => {
    const summary = summarizeReason(
      {
        kind: 'importer',
        changedFile: project.path('src/login.ts'),
        sourceFile: project.path('src/header.ts'),
        depth: 1,
        chain: [project.path('src/login.ts'), project.path('src/header.ts')],
      },
      project.root,
    );
    expect(summary).toBe('rodou porque src/header.ts importa src/login.ts (1 nivel)');
  });

  it('descreve a cadeia intermediaria de um importador transitivo', () => {
    const summary = summarizeReason(
      {
        kind: 'importer',
        changedFile: project.path('src/login.ts'),
        sourceFile: project.path('src/layout.ts'),
        depth: 2,
        chain: [
          project.path('src/login.ts'),
          project.path('src/header.ts'),
          project.path('src/layout.ts'),
        ],
      },
      project.root,
    );
    expect(summary).toBe(
      'rodou porque src/layout.ts importa src/login.ts via src/header.ts (2 niveis)',
    );
  });

  it('descreve selecao manual', () => {
    const summary = summarizeReason(
      {
        kind: 'manual',
        changedFile: project.path('src/a.ts'),
        sourceFile: project.path('src/a.ts'),
        depth: 0,
        chain: [],
      },
      project.root,
    );
    expect(summary).toContain('pedido explicito');
  });
});

describe('planBatch — invariantes do grafo', () => {
  /** Grafo falso que devolve os impactados na ordem que o teste pedir. */
  function grafoComOrdem(nos: Array<{ file: string; depth: number; chain: string[] }>) {
    return {
      index: async () => {},
      update: async () => {},
      remove: () => {},
      dependenciesOf: () => [],
      dependentsOf: () => [],
      impactedBy: () => nos,
      unresolvedOf: () => [],
      files: () => [],
      size: () => 0,
      dispose: async () => {},
    };
  }

  it('mantem o caminho mais curto quando o grafo devolve fora de ordem', () => {
    const { config } = resolveConfig({ useGitignore: false }, { root: project.root });
    const resolver = createTestFileResolver({ config });
    const login = project.path('src/login.ts');

    // O caminho longo vem primeiro; o curto chega depois e deve substitui-lo.
    const plan = planBatch({
      config,
      graph: grafoComOrdem([
        {
          file: project.path('src/layout.ts'),
          depth: 3,
          chain: [login, project.path('src/header.ts'), project.path('src/layout.ts')],
        },
        { file: project.path('src/layout.ts'), depth: 1, chain: [login, project.path('src/layout.ts')] },
      ]),
      resolver,
      changedFiles: [login],
    });

    const motivos = plan.entries[0]?.reasons[project.path('src/layout.test.ts')] ?? [];
    expect(motivos).toHaveLength(1);
    expect(motivos[0]?.depth).toBe(1);
  });

  it('descarta um caminho mais longo para o mesmo arquivo alterado', () => {
    const { config } = resolveConfig({ useGitignore: false }, { root: project.root });
    const resolver = createTestFileResolver({ config });
    const login = project.path('src/login.ts');

    const plan = planBatch({
      config,
      graph: grafoComOrdem([
        { file: project.path('src/layout.ts'), depth: 1, chain: [login, project.path('src/layout.ts')] },
        { file: project.path('src/layout.ts'), depth: 4, chain: [login, project.path('src/layout.ts')] },
      ]),
      resolver,
      changedFiles: [login],
    });

    expect(plan.entries[0]?.reasons[project.path('src/layout.test.ts')]?.[0]?.depth).toBe(1);
  });
});

describe('planBatch — runner do arquivo de teste', () => {
  it('cai para o runner do fonte quando o teste nao casa com nenhum match', () => {
    // O template gera um arquivo `.fixture`, que nenhum `match` cobre.
    const { config } = resolveConfig(
      {
        useGitignore: false,
        runners: {
          js: { match: ['src/**/*.ts'], testPatterns: ['{dir}/{name}.fixture'], testMatch: [] },
        },
      },
      { root: project.root },
    );
    const resolver = createTestFileResolver({ config, exists: () => true });
    const plan = planBatch({
      config,
      graph,
      resolver,
      changedFiles: [project.path('src/login.ts')],
    });
    expect(plan.entries[0]?.runnerKey).toBe('js');
    expect(rel(plan.entries[0]?.testFiles ?? [])).toContain('src/login.fixture');
  });
});
