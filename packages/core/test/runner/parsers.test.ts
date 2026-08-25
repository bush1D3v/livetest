import { describe, expect, it } from 'vitest';

import { countCases, parseJestLikeJson } from '../../src/runner/parsers/jest-like.js';
import { decodeXmlEntities, parseJUnitXml } from '../../src/runner/parsers/junit-xml.js';
import { normalizePath } from '../../src/util/paths.js';

const root = normalizePath('/proj');

describe('parseJestLikeJson', () => {
  it('interpreta um relatorio com sucesso e falha', () => {
    const report = JSON.stringify({
      numTotalTests: 2,
      testResults: [
        {
          name: '/proj/src/login.test.ts',
          assertionResults: [
            { fullName: 'login > funciona', status: 'passed', duration: 3 },
            {
              fullName: 'login > falha',
              status: 'failed',
              duration: 5,
              failureMessages: ['esperado 1, recebido 2'],
            },
          ],
        },
      ],
    });
    const result = parseJestLikeJson(report);
    expect(result.status).toBe('failed');
    expect(result.counts).toEqual({ total: 2, passed: 1, failed: 1, skipped: 0 });
    expect(result.cases[0]).toEqual({
      fullName: 'login > funciona',
      file: normalizePath('/proj/src/login.test.ts'),
      status: 'passed',
      durationMs: 3,
      failureMessages: [],
    });
    expect(result.cases[1]?.failureMessages).toEqual(['esperado 1, recebido 2']);
  });

  it('marca como passed quando nao ha falhas', () => {
    const report = JSON.stringify({
      testResults: [{ name: '/a.test.ts', assertionResults: [{ fullName: 'x', status: 'passed' }] }],
    });
    expect(parseJestLikeJson(report).status).toBe('passed');
  });

  it('mapeia pending, skipped e todo para skipped', () => {
    const report = JSON.stringify({
      testResults: [
        {
          name: '/a.test.ts',
          assertionResults: [
            { fullName: 'a', status: 'pending' },
            { fullName: 'b', status: 'todo' },
            { fullName: 'c', status: 'skipped' },
          ],
        },
      ],
    });
    expect(parseJestLikeJson(report).counts.skipped).toBe(3);
  });

  it('usa title quando fullName esta ausente', () => {
    const report = JSON.stringify({
      testResults: [{ name: '/a.test.ts', assertionResults: [{ title: 'so titulo', status: 'passed' }] }],
    });
    expect(parseJestLikeJson(report).cases[0]?.fullName).toBe('so titulo');
  });

  it('tolera relatorio sem testResults', () => {
    const result = parseJestLikeJson('{}');
    expect(result.status).toBe('passed');
    expect(result.counts.total).toBe(0);
  });

  it('devolve errored para JSON invalido', () => {
    const result = parseJestLikeJson('nao e json');
    expect(result.status).toBe('errored');
    expect(result.error).toContain('JSON invalido');
  });
});

describe('countCases', () => {
  it('conta por status', () => {
    expect(
      countCases([
        { fullName: 'a', file: null, status: 'passed', durationMs: null, failureMessages: [] },
        { fullName: 'b', file: null, status: 'failed', durationMs: null, failureMessages: [] },
        { fullName: 'c', file: null, status: 'skipped', durationMs: null, failureMessages: [] },
      ]),
    ).toEqual({ total: 3, passed: 1, failed: 1, skipped: 1 });
  });
});

describe('decodeXmlEntities', () => {
  it('decodifica as entidades usadas pelo pytest', () => {
    expect(decodeXmlEntities('a &lt;b&gt; &quot;c&quot; &apos;d&apos; &amp; e&#10;f')).toBe(
      'a <b> "c" \'d\' & e\nf',
    );
  });
});

describe('parseJUnitXml', () => {
  it('interpreta casos com sucesso, falha e skip', () => {
    const xml = [
      '<testsuites><testsuite name="pytest" tests="3">',
      '<testcase classname="tests.test_a" name="test_ok" file="tests/test_a.py" time="0.012"/>',
      '<testcase classname="tests.test_a" name="test_bad" file="tests/test_a.py" time="0.5">',
      '<failure message="assert 1 == 2">traceback aqui</failure></testcase>',
      '<testcase classname="tests.test_a" name="test_skip" file="tests/test_a.py">',
      '<skipped message="motivo"/></testcase>',
      '</testsuite></testsuites>',
    ].join('');

    const result = parseJUnitXml(xml, { root });
    expect(result.status).toBe('failed');
    expect(result.counts).toEqual({ total: 3, passed: 1, failed: 1, skipped: 1 });
    expect(result.cases[0]).toEqual({
      fullName: 'tests.test_a::test_ok',
      file: normalizePath('/proj/tests/test_a.py'),
      status: 'passed',
      durationMs: 12,
      failureMessages: [],
    });
    expect(result.cases[1]?.failureMessages[0]).toBe('assert 1 == 2\ntraceback aqui');
  });

  it('trata <error> como falha', () => {
    const xml = '<testcase name="t"><error message="collection error"/></testcase>';
    const result = parseJUnitXml(xml, { root });
    expect(result.counts.failed).toBe(1);
    expect(result.cases[0]?.failureMessages[0]).toBe('collection error');
  });

  it('usa apenas name quando nao ha classname', () => {
    expect(parseJUnitXml('<testcase name="solto"/>', { root }).cases[0]?.fullName).toBe('solto');
  });

  it('deixa file nulo quando o atributo esta ausente', () => {
    expect(parseJUnitXml('<testcase name="t"/>', { root }).cases[0]?.file).toBeNull();
  });

  it('devolve passed para suite vazia', () => {
    const result = parseJUnitXml('<testsuites></testsuites>', { root });
    expect(result.status).toBe('passed');
    expect(result.counts.total).toBe(0);
  });

  it('decodifica entidades na mensagem de falha', () => {
    const xml = '<testcase name="t"><failure message="a &lt; b"/></testcase>';
    expect(parseJUnitXml(xml, { root }).cases[0]?.failureMessages[0]).toBe('a < b');
  });
});

describe('parseJestLikeJson — bordas', () => {
  it('trata testResults que nao e array', () => {
    expect(parseJestLikeJson('{"testResults": "x"}').counts.total).toBe(0);
  });

  it('trata assertionResults que nao e array', () => {
    const report = JSON.stringify({ testResults: [{ name: '/a.ts', assertionResults: 'x' }] });
    expect(parseJestLikeJson(report).counts.total).toBe(0);
  });

  it('deixa file nulo quando o nome da suite nao e string', () => {
    const report = JSON.stringify({
      testResults: [{ name: 42, assertionResults: [{ fullName: 'x', status: 'passed' }] }],
    });
    expect(parseJestLikeJson(report).cases[0]?.file).toBeNull();
  });

  it('usa "(sem nome)" quando nao ha fullName nem title', () => {
    const report = JSON.stringify({
      testResults: [{ name: '/a.ts', assertionResults: [{ status: 'passed' }] }],
    });
    expect(parseJestLikeJson(report).cases[0]?.fullName).toBe('(sem nome)');
  });

  it('deixa duracao nula quando nao e numero', () => {
    const report = JSON.stringify({
      testResults: [{ name: '/a.ts', assertionResults: [{ fullName: 'x', status: 'passed', duration: 'rapido' }] }],
    });
    expect(parseJestLikeJson(report).cases[0]?.durationMs).toBeNull();
  });

  it('descarta mensagens de falha que nao sao string', () => {
    const report = JSON.stringify({
      testResults: [
        {
          name: '/a.ts',
          assertionResults: [{ fullName: 'x', status: 'failed', failureMessages: ['ok', 7, null] }],
        },
      ],
    });
    expect(parseJestLikeJson(report).cases[0]?.failureMessages).toEqual(['ok']);
  });
});

describe('parseJUnitXml — bordas', () => {
  it('trata testcase com corpo vazio', () => {
    const result = parseJUnitXml('<testcase name="t"></testcase>', { root });
    expect(result.counts.passed).toBe(1);
  });

  it('usa "(sem nome)" quando o atributo name esta ausente', () => {
    expect(parseJUnitXml('<testcase classname="c"/>', { root }).cases[0]?.fullName).toBe(
      'c::(sem nome)',
    );
  });

  it('deixa duracao nula quando time nao e numero', () => {
    expect(parseJUnitXml('<testcase name="t" time="rapido"/>', { root }).cases[0]?.durationMs)
      .toBeNull();
  });

  it('usa texto padrao quando a falha nao traz mensagem nem detalhe', () => {
    const result = parseJUnitXml('<testcase name="t"><failure/></testcase>', { root });
    expect(result.cases[0]?.failureMessages).toEqual(['failure sem detalhes']);
  });

  it('usa apenas o detalhe quando nao ha atributo message', () => {
    const result = parseJUnitXml('<testcase name="t"><failure>so o corpo</failure></testcase>', {
      root,
    });
    expect(result.cases[0]?.failureMessages).toEqual(['so o corpo']);
  });

  it('trata skipped sem mensagem', () => {
    const result = parseJUnitXml('<testcase name="t"><skipped/></testcase>', { root });
    expect(result.counts.skipped).toBe(1);
    expect(result.cases[0]?.failureMessages).toEqual([]);
  });

  it('ignora atributos malformados sem quebrar', () => {
    const result = parseJUnitXml('<testcase name="t" solto/>', { root });
    expect(result.cases[0]?.fullName).toBe('t');
  });
});

describe('parseJUnitXml — testcase auto-fechado vs com corpo', () => {
  it('trata os dois formatos na mesma suite', () => {
    const xml = [
      '<testsuite>',
      '<testcase name="auto"/>',
      '<testcase name="corpo"><failure message="m">d</failure></testcase>',
      '</testsuite>',
    ].join('');
    const result = parseJUnitXml(xml, { root });
    expect(result.counts).toEqual({ total: 2, passed: 1, failed: 1, skipped: 0 });
  });
});
