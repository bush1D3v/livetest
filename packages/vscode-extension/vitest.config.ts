import path from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // A API do editor nao existe fora dele. O mock permite testar
      // `src/extension.ts` — a unica camada que fala com o VSCode — sem baixar
      // e subir uma instancia real.
      vscode: path.resolve(import.meta.dirname, 'test/mocks/vscode.ts'),
    },
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
