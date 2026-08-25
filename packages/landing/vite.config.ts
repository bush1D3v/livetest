import { defineConfig } from 'vite';

export default defineConfig({
  // Caminhos relativos: a pagina funciona aberta direto do disco ou em
  // qualquer subdiretorio de um servidor estatico, sem reconfiguracao.
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    cssMinify: true,
    reportCompressedSize: true,
  },
});
