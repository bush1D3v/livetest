import { login } from './login.js';

/** Cabecalho: importa `login` diretamente. */
export function header(user: string, password: string): string {
  return login(user, password) ? `Ola, ${user}` : 'Entrar';
}
