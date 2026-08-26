import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // O jsdom leva ~15s para subir; so os testes de DOM pedem por ele, via
    // `@vitest-environment jsdom` no topo do arquivo.
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
