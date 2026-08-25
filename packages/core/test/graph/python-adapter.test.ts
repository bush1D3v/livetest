import { describe, expect, it, vi } from 'vitest';

import { createPythonGraphAdapter } from '../../src/graph/python/adapter.js';
import { createGraphAdapters } from '../../src/graph/registry.js';
import type { GraphAdapterContext } from '../../src/types/graph.js';
import { createRecordingLogger } from '../helpers/logger.js';
import { createTempProject, type TempProject } from '../helpers/tmp.js';

function contextFor(project: TempProject, pythonPath = 'python') {
  const degradations: string[] = [];
  const context: GraphAdapterContext = {
    root: project.root,
    logger: createRecordingLogger('debug').logger,
    pythonPath,
    reportDegradation: (message) => degradations.push(message),
  };
  return { context, degradations };
}

/** Projeto Python usado nos casos abaixo. */
const FILES = {
  'app/__init__.py': '',
  'app/login.py': 'def autenticar():\n    return True\n',
  'app/header.py': 'from .login import autenticar\n\ndef render():\n    return autenticar()\n',
  'app/footer.py': 'from app.login import autenticar\n',
  'app/util/__init__.py': '',
  'app/util/fmt.py': 'from ..login import autenticar\n',
};

describe('createPythonGraphAdapter', () => {
  it('resolve import relativo com o extrator AST real', async () => {
    const project = createTempProject(FILES);
    try {
      const adapter = createPythonGraphAdapter(contextFor(project).context);
      const [entry] = await adapter.analyze([project.path('app/header.py')]);
      expect(entry?.imports).toEqual([project.path('app/login.py')]);
    } finally {
      project.cleanup();
    }
  });

  it('resolve import absoluto a partir da raiz', async () => {
    const project = createTempProject(FILES);
    try {
      const adapter = createPythonGraphAdapter(contextFor(project).context);
      const [entry] = await adapter.analyze([project.path('app/footer.py')]);
      expect(entry?.imports).toEqual([project.path('app/login.py')]);
    } finally {
      project.cleanup();
    }
  });

  it('resolve import relativo de dois niveis', async () => {
    const project = createTempProject(FILES);
    try {
      const adapter = createPythonGraphAdapter(contextFor(project).context);
      const [entry] = await adapter.analyze([project.path('app/util/fmt.py')]);
      expect(entry?.imports).toEqual([project.path('app/login.py')]);
    } finally {
      project.cleanup();
    }
  });

  it('analisa o lote inteiro em um unico processo', async () => {
    const project = createTempProject(FILES);
    try {
      const adapter = createPythonGraphAdapter(contextFor(project).context);
      const entries = await adapter.analyze([
        project.path('app/header.py'),
        project.path('app/footer.py'),
      ]);
      expect(entries).toHaveLength(2);
      expect(entries.every((e) => e.imports[0] === project.path('app/login.py'))).toBe(true);
    } finally {
      project.cleanup();
    }
  });

  it('reporta arquivo com sintaxe invalida sem lancar', async () => {
    const project = createTempProject({ 'app/quebrado.py': 'def (' });
    try {
      const adapter = createPythonGraphAdapter(contextFor(project).context);
      const [entry] = await adapter.analyze([project.path('app/quebrado.py')]);
      expect(entry?.imports).toEqual([]);
      expect(entry?.unresolved.join(' ')).toContain('sintaxe');
    } finally {
      project.cleanup();
    }
  });

  it('degrada para o extrator por regex quando nao ha interpretador', async () => {
    const project = createTempProject(FILES);
    const { context, degradations } = contextFor(project, 'python-que-nao-existe-xyz');
    try {
      const adapter = createPythonGraphAdapter(context);
      const [entry] = await adapter.analyze([project.path('app/header.py')]);
      expect(entry?.imports).toEqual([project.path('app/login.py')]);
      expect(degradations).toHaveLength(1);
      expect(degradations[0]).toContain('expressao regular');
    } finally {
      project.cleanup();
    }
  });

  it('avisa sobre a degradacao apenas uma vez', async () => {
    const project = createTempProject(FILES);
    const { context, degradations } = contextFor(project, 'python-que-nao-existe-xyz');
    try {
      const adapter = createPythonGraphAdapter(context);
      await adapter.analyze([project.path('app/header.py')]);
      await adapter.analyze([project.path('app/footer.py')]);
      expect(degradations).toHaveLength(1);
    } finally {
      project.cleanup();
    }
  });

  it('aceita um extrator injetado', async () => {
    const project = createTempProject(FILES);
    try {
      const adapter = createPythonGraphAdapter(contextFor(project).context, {
        extractor: {
          id: 'fake',
          extract: async (files) =>
            files.map((file) => ({
              file,
              imports: [{ module: 'login', level: 1, names: [] }],
              error: null,
            })),
        },
      });
      const [entry] = await adapter.analyze([project.path('app/header.py')]);
      expect(entry?.imports).toEqual([project.path('app/login.py')]);
    } finally {
      project.cleanup();
    }
  });

  it('devolve lista vazia para lote vazio', async () => {
    const project = createTempProject({});
    try {
      const adapter = createPythonGraphAdapter(contextFor(project).context);
      await expect(adapter.analyze([])).resolves.toEqual([]);
    } finally {
      project.cleanup();
    }
  });
});

describe('createGraphAdapters', () => {
  it('instancia os adapters embutidos', () => {
    const project = createTempProject({});
    try {
      const { adapters, missing } = createGraphAdapters({
        ids: ['js-ts', 'python'],
        context: contextFor(project).context,
      });
      expect(adapters.map((a) => a.id).sort()).toEqual(['js-ts', 'python']);
      expect(missing).toEqual([]);
    } finally {
      project.cleanup();
    }
  });

  it('reporta ids desconhecidos em vez de lancar', () => {
    const project = createTempProject({});
    try {
      const { adapters, missing } = createGraphAdapters({
        ids: ['js-ts', 'cobol'],
        context: contextFor(project).context,
      });
      expect(adapters).toHaveLength(1);
      expect(missing).toEqual(['cobol']);
    } finally {
      project.cleanup();
    }
  });

  it('aceita fabricas customizadas', () => {
    const project = createTempProject({});
    try {
      const { adapters } = createGraphAdapters({
        ids: ['go'],
        context: contextFor(project).context,
        custom: {
          go: () => ({ id: 'go', extensions: ['.go'], analyze: async () => [] }),
        },
      });
      expect(adapters[0]?.id).toBe('go');
    } finally {
      project.cleanup();
    }
  });

  it('deduplica ids repetidos', () => {
    const project = createTempProject({});
    try {
      const { adapters } = createGraphAdapters({
        ids: ['js-ts', 'js-ts'],
        context: contextFor(project).context,
      });
      expect(adapters).toHaveLength(1);
    } finally {
      project.cleanup();
    }
  });
});

describe('createPythonGraphAdapter — ciclo de vida e propagacao de erro', () => {
  it('libera os extratores no dispose', async () => {
    const project = createTempProject(FILES);
    const dispose = vi.fn();
    try {
      const adapter = createPythonGraphAdapter(contextFor(project).context, {
        extractor: { id: 'fake', extract: async () => [], dispose },
      });
      adapter.dispose?.();
      expect(dispose).toHaveBeenCalledOnce();
    } finally {
      project.cleanup();
    }
  });

  it('dispose funciona sem extrator injetado', async () => {
    const project = createTempProject(FILES);
    try {
      const adapter = createPythonGraphAdapter(contextFor(project).context);
      expect(() => adapter.dispose?.()).not.toThrow();
    } finally {
      project.cleanup();
    }
  });

  it('aceita um script auxiliar customizado', async () => {
    const project = createTempProject({
      ...FILES,
      'meu_helper.py': [
        'import json, sys',
        'payload = json.loads(sys.stdin.read())',
        'resultados = [{"file": f, "imports": [], "error": None} for f in payload["files"]]',
        'json.dump({"results": resultados, "error": None}, sys.stdout)',
      ].join('\n'),
    });
    try {
      const adapter = createPythonGraphAdapter(contextFor(project).context, {
        scriptPath: project.path('meu_helper.py'),
      });
      const [entry] = await adapter.analyze([project.path('app/header.py')]);
      expect(entry?.imports).toEqual([]);
    } finally {
      project.cleanup();
    }
  });

  it('deixa subir erro que nao e de indisponibilidade do Python', async () => {
    const project = createTempProject(FILES);
    try {
      const adapter = createPythonGraphAdapter(contextFor(project).context, {
        extractor: {
          id: 'quebrado',
          extract: async () => {
            throw new TypeError('bug no extrator');
          },
        },
      });
      await expect(adapter.analyze([project.path('app/header.py')])).rejects.toThrow(
        'bug no extrator',
      );
    } finally {
      project.cleanup();
    }
  });

  it('respeita sourceRoots customizados', async () => {
    const project = createTempProject({
      'lib/pacote/__init__.py': '',
      'lib/pacote/base.py': 'X = 1\n',
      'lib/pacote/uso.py': 'from pacote.base import X\n',
    });
    try {
      const adapter = createPythonGraphAdapter(contextFor(project).context, {
        sourceRoots: ['lib'],
      });
      const [entry] = await adapter.analyze([project.path('lib/pacote/uso.py')]);
      expect(entry?.imports).toEqual([project.path('lib/pacote/base.py')]);
    } finally {
      project.cleanup();
    }
  });
});

describe('createPythonGraphAdapter — erro inesperado do extrator AST', () => {
  it('deixa subir TypeError vindo de uma saida malformada do script', async () => {
    const project = createTempProject({
      ...FILES,
      // "Interpretador" que devolve results com item nulo: quebra o mapeamento.
      'fake_helper.js': 'process.stdout.write(JSON.stringify({ results: [null] }));',
    });
    const context = {
      root: project.root,
      logger: createRecordingLogger('error').logger,
      pythonPath: process.execPath,
      reportDegradation: () => {},
    };
    try {
      const adapter = createPythonGraphAdapter(context, {
        scriptPath: project.path('fake_helper.js'),
      });
      await expect(adapter.analyze([project.path('app/header.py')])).rejects.toThrow(TypeError);
    } finally {
      project.cleanup();
    }
  });
});
