import { describe, expect, it } from 'vitest';

import { aggregateBatch, deriveBatchStatus, sumCounts } from '../../src/state/aggregate.js';
import type { TestRunResult } from '../../src/types/results.js';

function run(partial: Partial<TestRunResult> = {}): TestRunResult {
  return {
    runId: 'run-1',
    batchId: 'batch-1',
    runnerKey: 'js',
    adapterId: 'vitest',
    testFiles: ['/a.test.ts'],
    command: 'npx vitest run',
    status: 'passed',
    counts: { total: 1, passed: 1, failed: 0, skipped: 0 },
    cases: [],
    durationMs: 100,
    exitCode: 0,
    stdoutTail: [],
    stderrTail: [],
    error: null,
    reasons: {},
    ...partial,
  };
}

describe('deriveBatchStatus', () => {
  it('devolve skipped para lista vazia', () => {
    expect(deriveBatchStatus([])).toBe('skipped');
  });

  it('erro tem precedencia sobre tudo', () => {
    expect(deriveBatchStatus(['passed', 'failed', 'errored'])).toBe('errored');
  });

  it('cancelado tem precedencia sobre falha', () => {
    expect(deriveBatchStatus(['failed', 'cancelled'])).toBe('cancelled');
  });

  it('falha tem precedencia sobre sucesso', () => {
    expect(deriveBatchStatus(['passed', 'failed'])).toBe('failed');
  });

  it('so devolve skipped quando tudo foi pulado', () => {
    expect(deriveBatchStatus(['skipped', 'skipped'])).toBe('skipped');
    expect(deriveBatchStatus(['skipped', 'passed'])).toBe('passed');
  });
});

describe('sumCounts', () => {
  it('soma as contagens de varias execucoes', () => {
    expect(
      sumCounts([
        run({ counts: { total: 3, passed: 2, failed: 1, skipped: 0 } }),
        run({ counts: { total: 2, passed: 1, failed: 0, skipped: 1 } }),
      ]),
    ).toEqual({ total: 5, passed: 3, failed: 1, skipped: 1 });
  });

  it('devolve zeros para lista vazia', () => {
    expect(sumCounts([])).toEqual({ total: 0, passed: 0, failed: 0, skipped: 0 });
  });
});

describe('aggregateBatch', () => {
  it('monta o resultado consolidado', () => {
    const result = aggregateBatch({
      batchId: 'batch-7',
      changedFiles: ['/src/a.ts'],
      runs: [run({ status: 'failed', counts: { total: 2, passed: 1, failed: 1, skipped: 0 } })],
      unmatched: [{ file: '/src/b.ts', reason: 'sem teste' }],
      startedAt: 1000,
      finishedAt: 1450,
    });
    expect(result.batchId).toBe('batch-7');
    expect(result.status).toBe('failed');
    expect(result.durationMs).toBe(450);
    expect(result.counts.failed).toBe(1);
    expect(result.unmatched).toHaveLength(1);
  });

  it('nunca devolve duracao negativa', () => {
    const result = aggregateBatch({
      batchId: 'b',
      changedFiles: [],
      runs: [],
      unmatched: [],
      startedAt: 2000,
      finishedAt: 1000,
    });
    expect(result.durationMs).toBe(0);
  });
});
