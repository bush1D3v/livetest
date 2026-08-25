/**
 * Parser de relatorio JUnit XML, o formato que o pytest gera nativamente com
 * `--junitxml` (sem exigir plugin externo).
 *
 * A leitura e feita por varredura de tags em vez de um parser XML completo:
 * o formato produzido pelo pytest e regular e raso, e evitamos uma dependencia
 * a mais em uma ferramenta que roda em loop durante o desenvolvimento.
 *
 * Sao reconhecidos `<testcase>` com filhos `<failure>`, `<error>` e `<skipped>`.
 * Com `-o junit_family=xunit1` o pytest inclui o atributo `file`, que usamos
 * para associar cada caso ao seu arquivo.
 *
 * @packageDocumentation
 */

import type { TestCaseResult, TestCaseStatus } from '../../types/results.js';
import type { RunnerParseResult } from '../../types/runner.js';
import { joinPosix, normalizePath } from '../../util/paths.js';
import { countCases } from './jest-like.js';

/** Casa uma tag `<testcase ...>` completa, com ou sem filhos. */
const TESTCASE_RE = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
/** Casa um atributo `nome="valor"`. */
const ATTR_RE = /([\w:.-]+)\s*=\s*"([^"]*)"/g;
/** Casa o filho que determina o status do caso. */
const OUTCOME_RE = /<(failure|error|skipped)\b([^>]*?)(\/>|>([\s\S]*?)<\/\1>)/;

/** Desfaz as entidades XML usadas pelo pytest. */
export function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#10;/g, '\n')
    .replace(/&#9;/g, '\t')
    .replace(/&amp;/g, '&');
}

/** Extrai os atributos de uma tag em um objeto. */
function parseAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  ATTR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ATTR_RE.exec(raw)) !== null) {
    attributes[match[1] as string] = decodeXmlEntities(match[2] as string);
  }
  return attributes;
}

/** Monta o nome completo do caso a partir de `classname` e `name`. */
function buildFullName(attributes: Record<string, string>): string {
  const className = attributes['classname'] ?? '';
  const name = attributes['name'] ?? '(sem nome)';
  return className ? `${className}::${name}` : name;
}

/** Opcoes de {@link parseJUnitXml}. */
export interface ParseJUnitOptions {
  /** Raiz usada para transformar o atributo `file` (relativo) em absoluto. */
  root: string;
}

/**
 * Interpreta um relatorio JUnit XML.
 *
 * @param content - Conteudo do arquivo gerado por `--junitxml`.
 * @param options - Raiz do projeto, para absolutizar os caminhos.
 *
 * @example
 * ```ts
 * parseJUnitXml('<testsuite><testcase name="test_ok"/></testsuite>', { root: '/proj' });
 * // { status: 'passed', counts: { total: 1, passed: 1, ... }, ... }
 * ```
 */
export function parseJUnitXml(content: string, options: ParseJUnitOptions): RunnerParseResult {
  const cases: TestCaseResult[] = [];
  const root = normalizePath(options.root);

  TESTCASE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TESTCASE_RE.exec(content)) !== null) {
    // O grupo de atributos sempre participa do casamento (aceita vazio); o
    // corpo e opcional, porque a tag pode vir auto-fechada.
    const attributes = parseAttributes(match[1] as string);
    const body = match[3] ?? '';

    let status: TestCaseStatus = 'passed';
    const failureMessages: string[] = [];

    const outcome = OUTCOME_RE.exec(body);
    if (outcome) {
      const kind = outcome[1];
      status = kind === 'skipped' ? 'skipped' : 'failed';
      if (status === 'failed') {
        // O grupo de atributos sempre participa do casamento (aceita vazio).
        const outcomeAttributes = parseAttributes(outcome[2] as string);
        const detail = decodeXmlEntities((outcome[4] ?? '').trim());
        const message = outcomeAttributes['message'] ?? '';
        const combined = [message, detail].filter((part) => part.length > 0).join('\n');
        failureMessages.push(combined.length > 0 ? combined : `${kind} sem detalhes`);
      }
    }

    const rawFile = attributes['file'];
    const time = Number.parseFloat(attributes['time'] ?? '');

    cases.push({
      fullName: buildFullName(attributes),
      file: rawFile ? normalizePath(joinPosix(root, rawFile)) : null,
      status,
      durationMs: Number.isFinite(time) ? Math.round(time * 1000) : null,
      failureMessages,
    });
  }

  const counts = countCases(cases);
  return {
    status: counts.failed > 0 ? 'failed' : 'passed',
    counts,
    cases,
    error: null,
  };
}
