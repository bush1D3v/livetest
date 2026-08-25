import { describe, expect, it } from 'vitest';
import { login } from './login.js';

describe('login', () => {
  it('aceita senha com 8 caracteres ou mais', () => {
    expect(login('ana', 'senha1234')).toBe(true);
  });

  it('rejeita senha curta', () => {
    expect(login('ana', '123')).toBe(false);
  });
});
