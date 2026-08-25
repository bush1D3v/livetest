import { expect, it } from 'vitest';
import { layout } from './layout.js';

it('embrulha o cabecalho', () => {
  expect(layout('ana', 'senha1234')).toBe('<div>Ola, ana</div>');
});
