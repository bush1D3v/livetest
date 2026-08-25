# demo-js

Projeto de exemplo em TypeScript com Vitest.

`src/login.ts` está no fundo da cadeia de dependência e tem
`"dependencyDepth": "transitive"` no `livetest.config.json` — alterá-lo dispara os
quatro arquivos de teste. Os demais arquivos usam o padrão `direct`.

```bash
node ../../packages/cli/bin/livetest.mjs why src/login.ts
node ../../packages/cli/bin/livetest.mjs run src/login.ts
```
