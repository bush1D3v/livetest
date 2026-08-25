import { expect, it } from 'vitest';
import { header } from './header.js';

it('sauda o usuario autenticado', () => {
  expect(header('ana', 'senha1234')).toBe('Ola, ana');
});
