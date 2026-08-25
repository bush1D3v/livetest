import { expect, it } from 'vitest';
import { footer } from './footer.js';

it('mostra Sair para usuario autenticado', () => {
  expect(footer('ana', 'senha1234')).toBe('Sair');
});
