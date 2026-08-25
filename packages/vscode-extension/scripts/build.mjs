/**
 * Empacota a extensao em um unico arquivo CommonJS.
 *
 * O VSCode carrega extensoes como CommonJS, mas `@livetest/core` e ESM puro.
 * O bundle resolve os dois mundos e ainda evita depender de `node_modules`
 * dentro do `.vsix`. Apenas `vscode` fica externo — ele e injetado pelo editor.
 */

import { build, context } from 'esbuild';

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/extension.ts'],
  outfile: 'dist/extension.cjs',
  bundle: true,
  platform: 'node',
  target: 'node18',
  format: 'cjs',
  sourcemap: true,
  external: ['vscode'],
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('[livetest] observando mudancas da extensao...');
} else {
  await build(options);
}
