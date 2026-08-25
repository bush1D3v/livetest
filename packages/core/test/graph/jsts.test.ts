import { describe, expect, it } from 'vitest';

import { createJsTsGraphAdapter, loadCompilerOptions } from '../../src/graph/jsts/adapter.js';
import type { GraphAdapterContext } from '../../src/types/graph.js';
import { createRecordingLogger } from '../helpers/logger.js';
import { createTempProject, type TempProject } from '../helpers/tmp.js';

function contextFor(project: TempProject): {
  context: GraphAdapterContext;
  degradations: string[];
} {
  const degradations: string[] = [];
  return {
    degradations,
    context: {
      root: project.root,
      logger: createRecordingLogger('debug').logger,
      pythonPath: 'python',
      reportDegradation: (message) => degradations.push(message),
    },
  };
}

describe('createJsTsGraphAdapter', () => {
  it('resolve imports relativos sem extensao', async () => {
    const project = createTempProject({
      'src/login.ts': 'export const login = () => true;',
      'src/header.ts': "import { login } from './login';\nexport const header = login;",
    });
    try {
      const adapter = createJsTsGraphAdapter(contextFor(project).context);
      const [entry] = await adapter.analyze([project.path('src/header.ts')]);
      expect(entry?.imports).toEqual([project.path('src/login.ts')]);
    } finally {
      project.cleanup();
    }
  });

  it('resolve o especificador .js de projetos ESM para o arquivo .ts', async () => {
    const project = createTempProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { module: 'NodeNext', moduleResolution: 'NodeNext' },
      }),
      'src/login.ts': 'export const login = 1;',
      'src/header.ts': "import { login } from './login.js';\nexport default login;",
    });
    try {
      const adapter = createJsTsGraphAdapter(contextFor(project).context);
      const [entry] = await adapter.analyze([project.path('src/header.ts')]);
      expect(entry?.imports).toEqual([project.path('src/login.ts')]);
    } finally {
      project.cleanup();
    }
  });

  it('resolve index.ts de um diretorio', async () => {
    const project = createTempProject({
      'src/auth/index.ts': 'export const auth = 1;',
      'src/app.ts': "import { auth } from './auth';\nexport default auth;",
    });
    try {
      const adapter = createJsTsGraphAdapter(contextFor(project).context);
      const [entry] = await adapter.analyze([project.path('src/app.ts')]);
      expect(entry?.imports).toEqual([project.path('src/auth/index.ts')]);
    } finally {
      project.cleanup();
    }
  });

  it('resolve aliases de tsconfig paths', async () => {
    const project = createTempProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@app/*': ['src/*'] } },
      }),
      'src/login.ts': 'export const login = 1;',
      'src/header.ts': "import { login } from '@app/login';\nexport default login;",
    });
    try {
      const adapter = createJsTsGraphAdapter(contextFor(project).context);
      const [entry] = await adapter.analyze([project.path('src/header.ts')]);
      expect(entry?.imports).toEqual([project.path('src/login.ts')]);
    } finally {
      project.cleanup();
    }
  });

  it('descarta pacotes de node_modules', async () => {
    const project = createTempProject({
      'node_modules/lib/index.js': 'module.exports = 1;',
      'node_modules/lib/package.json': JSON.stringify({ name: 'lib', main: 'index.js' }),
      'src/app.ts': "import lib from 'lib';\nexport default lib;",
    });
    try {
      const adapter = createJsTsGraphAdapter(contextFor(project).context);
      const [entry] = await adapter.analyze([project.path('src/app.ts')]);
      expect(entry?.imports).toEqual([]);
    } finally {
      project.cleanup();
    }
  });

  it('captura export ... from e require', async () => {
    const project = createTempProject({
      'src/a.ts': 'export const a = 1;',
      'src/b.js': 'module.exports = 2;',
      'src/index.ts': "export * from './a';\nconst b = require('./b');\nexport default b;",
    });
    try {
      const adapter = createJsTsGraphAdapter(contextFor(project).context);
      const [entry] = await adapter.analyze([project.path('src/index.ts')]);
      expect(entry?.imports.sort()).toEqual([project.path('src/a.ts'), project.path('src/b.js')]);
    } finally {
      project.cleanup();
    }
  });

  it('captura import() dinamico com literal', async () => {
    const project = createTempProject({
      'src/lazy.ts': 'export const lazy = 1;',
      'src/app.ts': "export const load = () => import('./lazy');",
    });
    try {
      const adapter = createJsTsGraphAdapter(contextFor(project).context);
      const [entry] = await adapter.analyze([project.path('src/app.ts')]);
      expect(entry?.imports).toEqual([project.path('src/lazy.ts')]);
    } finally {
      project.cleanup();
    }
  });
});

describe('createJsTsGraphAdapter — transparencia e robustez', () => {
  it('reporta import dinamico com expressao nao literal', async () => {
    const project = createTempProject({
      'src/app.ts': 'export const load = (n: string) => import(`./mod/${n}`);',
    });
    try {
      const adapter = createJsTsGraphAdapter(contextFor(project).context);
      const [entry] = await adapter.analyze([project.path('src/app.ts')]);
      expect(entry?.unresolved.join(' ')).toContain('import dinamico');
    } finally {
      project.cleanup();
    }
  });

  it('registra import relativo que nao resolve', async () => {
    const project = createTempProject({ 'src/app.ts': "import x from './sumiu';\nexport default x;" });
    try {
      const adapter = createJsTsGraphAdapter(contextFor(project).context);
      const [entry] = await adapter.analyze([project.path('src/app.ts')]);
      expect(entry?.imports).toEqual([]);
      expect(entry?.unresolved).toContain('./sumiu');
    } finally {
      project.cleanup();
    }
  });

  it('nao lanca quando o arquivo desapareceu entre o evento e a analise', async () => {
    const project = createTempProject({});
    try {
      const adapter = createJsTsGraphAdapter(contextFor(project).context);
      const [entry] = await adapter.analyze([project.path('src/inexistente.ts')]);
      expect(entry).toEqual({
        file: project.path('src/inexistente.ts'),
        imports: [],
        unresolved: [],
      });
    } finally {
      project.cleanup();
    }
  });

  it('ignora arquivos .d.ts como alvo de import', async () => {
    const project = createTempProject({
      'src/tipos.d.ts': 'export declare const x: number;',
      'src/app.ts': "import type { x } from './tipos';\nexport type Y = typeof x;",
    });
    try {
      const adapter = createJsTsGraphAdapter(contextFor(project).context);
      const [entry] = await adapter.analyze([project.path('src/app.ts')]);
      expect(entry?.imports).toEqual([]);
    } finally {
      project.cleanup();
    }
  });

  it('analisa varios arquivos em um unico lote', async () => {
    const project = createTempProject({
      'src/a.ts': 'export const a = 1;',
      'src/b.ts': "import { a } from './a';\nexport default a;",
      'src/c.ts': "import { a } from './a';\nexport default a;",
    });
    try {
      const adapter = createJsTsGraphAdapter(contextFor(project).context);
      const entries = await adapter.analyze([project.path('src/b.ts'), project.path('src/c.ts')]);
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.imports[0] === project.path('src/a.ts'))).toBe(true);
    } finally {
      project.cleanup();
    }
  });
});

describe('loadCompilerOptions', () => {
  it('usa o tsconfig do projeto quando existe', () => {
    const project = createTempProject({
      'tsconfig.json': JSON.stringify({ compilerOptions: { strict: true, target: 'ES2020' } }),
    });
    try {
      const result = loadCompilerOptions(project.root);
      expect(result.configPath).toBe(project.path('tsconfig.json'));
      expect(result.options.strict).toBe(true);
    } finally {
      project.cleanup();
    }
  });

  it('cai para as opcoes padrao quando nao ha tsconfig', () => {
    const project = createTempProject({});
    try {
      const result = loadCompilerOptions(project.root, null);
      expect(result.configPath).toBeNull();
      expect(result.options.allowJs).toBe(true);
    } finally {
      project.cleanup();
    }
  });

  it('cai para as opcoes padrao quando o tsconfig e invalido', () => {
    const project = createTempProject({ 'tsconfig.json': '{ invalido' });
    try {
      const result = loadCompilerOptions(project.root, project.path('tsconfig.json'));
      expect(result.configPath).toBeNull();
    } finally {
      project.cleanup();
    }
  });
});

describe('createJsTsGraphAdapter — degradacao', () => {
  it('cai para as opcoes padrao quando o parse do tsconfig lanca', () => {
    // JSON valido que o proprio TypeScript nao consegue interpretar.
    const project = createTempProject({ 'tsconfig.json': '{"references": [null]}' });
    try {
      const result = loadCompilerOptions(project.root);
      expect(result.configPath).toBeNull();
      expect(result.options.allowJs).toBe(true);
    } finally {
      project.cleanup();
    }
  });

  it('reporta degradacao quando o scanner do TypeScript lanca', async () => {
    const project = createTempProject({ 'src/app.ts': 'export const a = 1;' });
    const { context, degradations } = contextFor(project);
    try {
      const adapter = createJsTsGraphAdapter(context, {
        preProcessFile: () => {
          throw new Error('scanner explodiu');
        },
      });
      const [entry] = await adapter.analyze([project.path('src/app.ts')]);
      expect(entry).toEqual({ file: project.path('src/app.ts'), imports: [], unresolved: [] });
      expect(degradations[0]).toContain('nao foi possivel analisar imports');
    } finally {
      project.cleanup();
    }
  });

  it('reporta degradacao quando o scanner lanca algo que nao e Error', async () => {
    const project = createTempProject({ 'src/app.ts': 'export const a = 1;' });
    const { context, degradations } = contextFor(project);
    try {
      const adapter = createJsTsGraphAdapter(context, {
        preProcessFile: () => {
          throw 'texto solto';
        },
      });
      await adapter.analyze([project.path('src/app.ts')]);
      expect(degradations).toHaveLength(1);
    } finally {
      project.cleanup();
    }
  });

  it('descarta import que resolve para fora da raiz do projeto', async () => {
    const externo = createTempProject({ 'compartilhado/util.ts': 'export const util = 1;' });
    const project = createTempProject({
      'tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@fora/*': [`${externo.root}/compartilhado/*`] } },
      }),
      'src/app.ts': "import { util } from '@fora/util';\nexport default util;",
    });
    try {
      const adapter = createJsTsGraphAdapter(contextFor(project).context);
      const [entry] = await adapter.analyze([project.path('src/app.ts')]);
      expect(entry?.imports).toEqual([]);
    } finally {
      project.cleanup();
      externo.cleanup();
    }
  });

  it('aceita tsconfig informado explicitamente', () => {
    const project = createTempProject({
      'config/tsconfig.build.json': JSON.stringify({ compilerOptions: { strict: false } }),
    });
    try {
      const result = loadCompilerOptions(project.root, project.path('config/tsconfig.build.json'));
      expect(result.configPath).toBe(project.path('config/tsconfig.build.json'));
    } finally {
      project.cleanup();
    }
  });

  it('cai para os defaults quando o tsconfig informado nao existe', () => {
    const project = createTempProject({});
    try {
      const result = loadCompilerOptions(project.root, project.path('nao-existe.json'));
      expect(result.configPath).toBeNull();
    } finally {
      project.cleanup();
    }
  });

  it('devolve lista vazia para lote vazio', async () => {
    const project = createTempProject({});
    try {
      const adapter = createJsTsGraphAdapter(contextFor(project).context);
      await expect(adapter.analyze([])).resolves.toEqual([]);
    } finally {
      project.cleanup();
    }
  });
});

describe('createJsTsGraphAdapter — node_modules por caminho relativo', () => {
  it('descarta import relativo que aponta para dentro de node_modules', async () => {
    const project = createTempProject({
      'node_modules/lib/index.js': 'module.exports = 1;',
      'src/app.ts': "import lib from '../node_modules/lib/index.js';\nexport default lib;",
    });
    try {
      const adapter = createJsTsGraphAdapter(contextFor(project).context);
      const [entry] = await adapter.analyze([project.path('src/app.ts')]);
      expect(entry?.imports).toEqual([]);
    } finally {
      project.cleanup();
    }
  });
});

describe('createJsTsGraphAdapter — alias apontando para node_modules', () => {
  it('descarta o alvo mesmo quando o TypeScript nao marca como biblioteca externa', async () => {
    const project = createTempProject({
      'node_modules/interno/util.ts': 'export const util = 1;',
      'tsconfig.json': JSON.stringify({
        compilerOptions: { baseUrl: '.', paths: { '@interno/*': ['node_modules/interno/*'] } },
      }),
      'src/app.ts': "import { util } from '@interno/util';\nexport default util;",
    });
    try {
      const adapter = createJsTsGraphAdapter(contextFor(project).context);
      const [entry] = await adapter.analyze([project.path('src/app.ts')]);
      expect(entry?.imports).toEqual([]);
    } finally {
      project.cleanup();
    }
  });
});
