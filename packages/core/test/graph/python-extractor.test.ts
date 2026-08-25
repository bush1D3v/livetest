import { describe, expect, it } from 'vitest';

import {
  createAstPythonExtractor,
  createRegexPythonExtractor,
  parsePythonImports,
  resolveHelperScriptPath,
} from '../../src/graph/python/extractor.js';
import { createTempProject } from '../helpers/tmp.js';

describe('parsePythonImports', () => {
  it('extrai import simples', () => {
    expect(parsePythonImports('import os')).toEqual([{ module: 'os', level: 0, names: [] }]);
  });

  it('extrai import com varios modulos e alias', () => {
    expect(parsePythonImports('import os, sys as system')).toEqual([
      { module: 'os', level: 0, names: [] },
      { module: 'sys', level: 0, names: [] },
    ]);
  });

  it('extrai from ... import com nomes', () => {
    expect(parsePythonImports('from app.auth import login, Session')).toEqual([
      { module: 'app.auth', level: 0, names: ['login', 'Session'] },
    ]);
  });

  it('conta os pontos de um import relativo', () => {
    expect(parsePythonImports('from ..core.db import conectar')).toEqual([
      { module: 'core.db', level: 2, names: ['conectar'] },
    ]);
  });

  it('trata from . import x (sem modulo)', () => {
    expect(parsePythonImports('from . import helpers')).toEqual([
      { module: null, level: 1, names: ['helpers'] },
    ]);
  });

  it('descarta o import estrela', () => {
    expect(parsePythonImports('from app import *')).toEqual([
      { module: 'app', level: 0, names: [] },
    ]);
  });

  it('junta continuacao por parenteses', () => {
    const source = 'from app.auth import (\n    login,\n    logout,\n)';
    expect(parsePythonImports(source)).toEqual([
      { module: 'app.auth', level: 0, names: ['login', 'logout'] },
    ]);
  });

  it('ignora comentarios', () => {
    expect(parsePythonImports('# import os\nimport sys')).toEqual([
      { module: 'sys', level: 0, names: [] },
    ]);
  });

  it('ignora imports dentro de docstring de tres aspas', () => {
    const source = ['"""', 'import fantasma', '"""', 'import real'].join('\n');
    expect(parsePythonImports(source)).toEqual([{ module: 'real', level: 0, names: [] }]);
  });

  it('devolve lista vazia para fonte sem imports', () => {
    expect(parsePythonImports('x = 1\n')).toEqual([]);
  });
});

describe('createRegexPythonExtractor', () => {
  it('le e analisa arquivos reais', async () => {
    const project = createTempProject({ 'app/a.py': 'from .b import x\n' });
    try {
      const extractor = createRegexPythonExtractor();
      const [entry] = await extractor.extract([project.path('app/a.py')]);
      expect(entry?.error).toBeNull();
      expect(entry?.imports).toEqual([{ module: 'b', level: 1, names: ['x'] }]);
    } finally {
      project.cleanup();
    }
  });

  it('reporta erro de leitura sem lancar', async () => {
    const extractor = createRegexPythonExtractor();
    const [entry] = await extractor.extract(['/nao/existe.py']);
    expect(entry?.error).toContain('leitura falhou');
    expect(entry?.imports).toEqual([]);
  });
});

describe('resolveHelperScriptPath', () => {
  it('aponta para o script empacotado', () => {
    expect(resolveHelperScriptPath()).toMatch(/assets\/livetest_py_imports\.py$/);
  });
});

describe('createAstPythonExtractor', () => {
  it('lanca PythonUnavailableError quando o interpretador nao existe', async () => {
    const extractor = createAstPythonExtractor({ pythonPath: 'python-que-nao-existe-xyz' });
    await expect(extractor.extract(['/qualquer.py'])).rejects.toThrow(/nao foi possivel executar/);
  });

  it('lanca quando o script auxiliar esta ausente', async () => {
    const extractor = createAstPythonExtractor({
      pythonPath: 'python',
      scriptPath: '/nao/existe/helper.py',
    });
    await expect(extractor.extract(['/a.py'])).rejects.toThrow(/script auxiliar ausente/);
  });

  it('devolve lista vazia sem invocar o processo para lote vazio', async () => {
    const extractor = createAstPythonExtractor({ pythonPath: 'python-que-nao-existe-xyz' });
    await expect(extractor.extract([])).resolves.toEqual([]);
  });
});

/**
 * O extrator AST so exige um executavel que leia stdin e escreva JSON em stdout.
 * Usar o proprio Node como "interpretador" permite simular, de forma
 * deterministica, todas as formas de o script auxiliar se comportar mal.
 */
function fakeInterpreter(corpo: string) {
  const project = createTempProject({ 'fake_helper.js': corpo });
  return {
    project,
    extractor: createAstPythonExtractor({
      pythonPath: process.execPath,
      scriptPath: project.path('fake_helper.js'),
      timeoutMs: 5000,
    }),
  };
}

describe('createAstPythonExtractor — saidas malformadas', () => {
  it('rejeita saida que nao e JSON', async () => {
    const { project, extractor } = fakeInterpreter('process.stdout.write("nao e json");');
    try {
      await expect(extractor.extract(['/a.py'])).rejects.toThrow(/nao e JSON/);
    } finally {
      project.cleanup();
    }
  });

  it('rejeita JSON sem results, usando a mensagem de erro do script', async () => {
    const { project, extractor } = fakeInterpreter(
      'process.stdout.write(JSON.stringify({ error: "stdin invalido" }));',
    );
    try {
      await expect(extractor.extract(['/a.py'])).rejects.toThrow(/stdin invalido/);
    } finally {
      project.cleanup();
    }
  });

  it('rejeita JSON sem results nem mensagem', async () => {
    const { project, extractor } = fakeInterpreter('process.stdout.write("{}");');
    try {
      await expect(extractor.extract(['/a.py'])).rejects.toThrow(/nao retornou resultados/);
    } finally {
      project.cleanup();
    }
  });

  it('rejeita quando o script sai com codigo diferente de zero', async () => {
    const { project, extractor } = fakeInterpreter(
      'process.stderr.write("traceback"); process.exit(2);',
    );
    try {
      await expect(extractor.extract(['/a.py'])).rejects.toThrow(/codigo 2: traceback/);
    } finally {
      project.cleanup();
    }
  });

  it('rejeita quando o script excede o tempo limite', async () => {
    const project = createTempProject({ 'fake_helper.js': 'setInterval(() => {}, 1000);' });
    const extractor = createAstPythonExtractor({
      pythonPath: process.execPath,
      scriptPath: project.path('fake_helper.js'),
      timeoutMs: 300,
    });
    try {
      await expect(extractor.extract(['/a.py'])).rejects.toThrow(/excedeu 300 ms/);
    } finally {
      project.cleanup();
    }
  });

  it('propaga erro que nao e de indisponibilidade', async () => {
    // `results` com um item nulo quebra o mapeamento com TypeError, nao com
    // PythonUnavailableError: o adapter precisa deixar esse erro subir.
    const { project, extractor } = fakeInterpreter(
      'process.stdout.write(JSON.stringify({ results: [null] }));',
    );
    try {
      await expect(extractor.extract(['/a.py'])).rejects.not.toThrow(/indisponivel/);
    } finally {
      project.cleanup();
    }
  });
});

describe('createAstPythonExtractor — normalizacao dos registros', () => {
  it('normaliza campos ausentes ou com tipo inesperado', async () => {
    const payload = {
      results: [
        {
          file: '/proj/a.py',
          imports: [
            { module: 'os', level: 0, names: ['path'] },
            { module: 42, level: 'um', names: 'nao-array' },
            { names: [1, 'valido', null] },
          ],
          error: null,
        },
        { file: '/proj/b.py', imports: 'nao-array', error: 'sintaxe invalida' },
        { imports: [], error: 7 },
      ],
    };
    const { project, extractor } = fakeInterpreter(
      `process.stdout.write(${JSON.stringify(JSON.stringify(payload))});`,
    );
    try {
      const resultados = await extractor.extract(['/proj/a.py']);

      expect(resultados[0]?.imports).toEqual([
        { module: 'os', level: 0, names: ['path'] },
        { module: null, level: 0, names: [] },
        { module: null, level: 0, names: ['valido'] },
      ]);
      // `imports` que nao e array vira lista vazia, sem quebrar.
      expect(resultados[1]).toMatchObject({ imports: [], error: 'sintaxe invalida' });
      // `error` que nao e string vira null; `file` ausente vira string vazia.
      expect(resultados[2]?.error).toBeNull();
    } finally {
      project.cleanup();
    }
  });

  it('usa o script empacotado quando nenhum caminho e informado', async () => {
    const extractor = createAstPythonExtractor({ pythonPath: 'python-que-nao-existe-xyz' });
    await expect(extractor.extract(['/a.py'])).rejects.toThrow(/nao foi possivel executar/);
  });
});

describe('parsePythonImports — mais casos', () => {
  it('trata import com parenteses em varias linhas sem fechar na mesma', () => {
    const source = 'from app import (a,\n b)\nimport os';
    expect(parsePythonImports(source)).toEqual([
      { module: 'app', level: 0, names: ['a', 'b'] },
      { module: 'os', level: 0, names: [] },
    ]);
  });

  it('ignora linha vazia e espacos', () => {
    expect(parsePythonImports('\n   \nimport os\n')).toEqual([
      { module: 'os', level: 0, names: [] },
    ]);
  });

  it('reconhece from .. import x (sem modulo, dois niveis)', () => {
    expect(parsePythonImports('from .. import helpers')).toEqual([
      { module: null, level: 2, names: ['helpers'] },
    ]);
  });

  it('descarta nomes vazios apos a virgula', () => {
    expect(parsePythonImports('from app import a, , b')).toEqual([
      { module: 'app', level: 0, names: ['a', 'b'] },
    ]);
  });

  it('lida com docstring de aspas simples triplas', () => {
    const source = ["'''", 'import fantasma', "'''", 'import real'].join('\n');
    expect(parsePythonImports(source)).toEqual([{ module: 'real', level: 0, names: [] }]);
  });

  it('nao confunde docstring de uma linha so', () => {
    expect(parsePythonImports('"""doc de uma linha"""\nimport os')).toEqual([
      { module: 'os', level: 0, names: [] },
    ]);
  });

  it('ignora linha que nao e import', () => {
    expect(parsePythonImports('x = importante')).toEqual([]);
  });
});
