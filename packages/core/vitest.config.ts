import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 20_000,
    hookTimeout: 20_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.ts'],
      // Estes cinco arquivos contem apenas `interface` e `type`: o TypeScript
      // os compila para um `export {}` vazio, sem uma unica instrucao para
      // cobrir. Ficam de fora para que a metrica meca codigo de verdade.
      // `src/types/events.ts` NAO esta aqui: ele exporta uma constante.
      exclude: [
        'src/types/config.ts',
        'src/types/graph.ts',
        'src/types/logging.ts',
        'src/types/results.ts',
        'src/types/runner.ts',
      ],
      thresholds: { lines: 100, functions: 100, branches: 100, statements: 100 },
    },
  },
});
