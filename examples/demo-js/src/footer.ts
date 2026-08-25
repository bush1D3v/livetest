import { login } from './login.js';

/** Rodape: tambem importa `login` diretamente. */
export function footer(user: string, password: string): string {
  return login(user, password) ? 'Sair' : '';
}
