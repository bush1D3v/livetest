import { header } from './header.js';

/** Layout: importa `header`, logo depende de `login` transitivamente. */
export function layout(user: string, password: string): string {
  return `<div>${header(user, password)}</div>`;
}
