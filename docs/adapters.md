# Escrevendo um adapter

Adicionar uma linguagem nova não exige tocar no core. Há dois pontos de extensão
independentes, e você pode implementar só um deles:

| Adapter | Responde | Sem ele |
|---|---|---|
| **Grafo de dependência** | "quem importa este arquivo?" | os arquivos ficam isolados; só o próprio teste roda |
| **Test runner** | "como rodo estes arquivos de teste e leio o resultado?" | use `adapter: "command"`, que julga pelo código de saída |

O caminho mais rápido para uma linguagem nova é **nenhum código**: `adapter: "command"`
+ `testPatterns` cobrem o básico. Um adapter dedicado vale a pena quando você quer
propagação por dependência ou resultados por caso de teste.

## Sem código: o adapter `command`

```jsonc
{
  "runners": {
    "go": {
      "adapter": "command",
      "command": "go",
      "args": ["test"],
      "match": ["**/*.go"],
      "testMatch": ["**/*_test.go"],
      "testPatterns": ["{dir}/{name}_test.go"],
      "testExtensions": ["go"]
    }
  }
}
```

Isto já dá watcher, debounce, mapeamento fonte→teste, execução incremental e os três
canais de saída. Falta apenas a propagação por dependência.

## Adapter de grafo de dependência

```ts
interface DependencyGraphAdapter {
  readonly id: string;
  readonly extensions: readonly string[];
  analyze(files: string[]): Promise<FileImports[]>;
  dispose?(): void | Promise<void>;
}

interface FileImports {
  file: string;        // absoluto, separadores POSIX
  imports: string[];   // arquivos DO PROJETO importados, absolutos
  unresolved: string[]; // especificadores que não resolveram — vira aviso
}
```

O core inverte esse mapa e responde a pergunta reversa. Você só precisa dizer, para
cada arquivo, o que ele importa.

### Contrato

1. **Nunca lance.** Arquivo com erro de sintaxe ou apagado entre o evento e a análise
   devolve `{ imports: [], unresolved: [] }`. Se `analyze` lançar, o core degrada o
   grupo inteiro e emite um `error` — funciona, mas é o caminho ruim.
2. **Caminhos absolutos, com `/`.** Inclusive no Windows. Use `normalizePath`.
3. **Só arquivos do projeto.** Descarte dependências instaladas: elas não têm testes
   no projeto e inchariam o grafo.
4. **Analise o lote inteiro de uma vez.** `analyze` recebe uma lista justamente para
   permitir um único processo/parse por lote, não um por arquivo.
5. **Reporte o que não resolveu.** Import dinâmico, injeção de dependência, reflexão —
   colocar em `unresolved` faz o aviso aparecer em `livetest why`, e a pessoa entende
   por que o grafo está incompleto ali.

### Exemplo: Go

```ts
import { spawn } from 'node:child_process';
import type { DependencyGraphAdapter, GraphAdapterContext } from '@livetest/core';
import { normalizePath } from '@livetest/core';

export function createGoGraphAdapter(context: GraphAdapterContext): DependencyGraphAdapter {
  return {
    id: 'go',
    extensions: ['.go'],

    async analyze(files) {
      try {
        // Um único `go list` para o lote inteiro.
        const saida = await rodarGoList(files, context.root);
        return files.map((file) => ({
          file,
          imports: (saida[file] ?? []).map((alvo) => normalizePath(alvo, context.root)),
          unresolved: [],
        }));
      } catch (erro) {
        context.reportDegradation(
          'nao foi possivel rodar `go list`',
          erro instanceof Error ? erro.message : String(erro),
        );
        return files.map((file) => ({ file, imports: [], unresolved: [] }));
      }
    },
  };
}
```

`context` traz `root`, um `logger` já prefixado, `pythonPath` e `reportDegradation` —
use este último em vez de lançar quando algo falhar mas der para continuar.

## Adapter de test runner

Duas funções puras: montar o comando e interpretar a saída. **O core executa o
processo**, o que dá cancelamento, timeout, captura limitada de saída e limpeza de
arquivos temporários de graça.

```ts
interface TestRunnerAdapter {
  readonly id: string;
  /** Extensão do relatório temporário, ex.: '.json'. `null`/ausente se não usa. */
  readonly reportFileExtension?: string | null;

  buildInvocation(
    testFiles: string[],
    context: RunnerAdapterContext,
    reportFile: string | null,
  ): RunnerInvocation;

  parseOutput(output: RunnerProcessOutput, context: RunnerAdapterContext): RunnerParseResult;
}
```

Quando `reportFileExtension` está definido, o core cria um caminho temporário único,
passa em `reportFile` para você repassar ao runner (`--outputFile=...`), lê o conteúdo
em `output.reportContent` e apaga o arquivo depois — mesmo se a execução falhar.

### Interpretando a saída

`parseOutput` **nunca deve lançar**. Trate os casos de infraestrutura antes de olhar o
relatório; o helper `interpretProcessFailure` faz isso:

```ts
import { interpretProcessFailure } from '@livetest/core';

parseOutput(output) {
  // Cuida de cancelamento, timeout e falha de spawn.
  const falha = interpretProcessFailure(output);
  if (falha) return falha;

  if (!output.reportContent) {
    return output.exitCode === 0
      ? { status: 'passed', counts: vazio, cases: [], error: null }
      : { status: 'errored', counts: vazio, cases: [],
          error: `o runner nao produziu relatorio (exit ${output.exitCode})` };
  }
  return interpretarMeuFormato(output.reportContent);
}
```

Distinga **`failed`** (o teste rodou e reprovou — o usuário conserta o código) de
**`errored`** (não deu para rodar — o usuário conserta o ambiente). A precedência de
status do lote depende disso.

### Exemplo: Go

```ts
import type { TestRunnerAdapter } from '@livetest/core';
import { interpretProcessFailure } from '@livetest/core';

export function createGoTestAdapter(): TestRunnerAdapter {
  return {
    id: 'go-test',
    reportFileExtension: null, // `go test -json` sai no stdout

    buildInvocation(testFiles, context) {
      return {
        command: context.config.command ?? 'go',
        args: ['test', '-json', ...pacotesDe(testFiles)],
        cwd: context.root,
        env: context.config.env ?? {},
        reportFile: null,
        timeoutMs: context.config.timeoutMs ?? 120_000,
      };
    },

    parseOutput(output) {
      const falha = interpretProcessFailure(output);
      if (falha) return falha;
      return interpretarGoTestJson(output.stdout);
    },
  };
}
```

## Registrando

```ts
import { createEngine, loadConfig } from '@livetest/core';

const { config } = await loadConfig({ cwd: process.cwd() });

const engine = createEngine({
  config,
  graphAdapters: { go: (context) => createGoGraphAdapter(context) },
  runnerAdapters: { 'go-test': () => createGoTestAdapter() },
});
```

E na configuração do projeto:

```jsonc
{
  "runners": {
    "go": {
      "adapter": "go-test",
      "graph": "go",
      "match": ["**/*.go"],
      "testMatch": ["**/*_test.go"],
      "testPatterns": ["{dir}/{name}_test.go"],
      "testExtensions": ["go"]
    }
  }
}
```

Um id desconhecido não derruba o daemon: gera um evento `error` explicando o que ficou
sem cobertura.

## Testando seu adapter

`buildInvocation` e `parseOutput` são funções puras — teste-as sem processo:

```ts
it('monta a linha de comando', () => {
  const invocacao = createGoTestAdapter().buildInvocation(['/proj/pkg/a_test.go'], contexto, null);
  expect(invocacao.args).toEqual(['test', '-json', './pkg']);
});

it('reporta timeout como errored', () => {
  const resultado = createGoTestAdapter().parseOutput({ ...saidaVazia, timedOut: true }, contexto);
  expect(resultado.status).toBe('errored');
});
```

Para o adapter de grafo, um projeto temporário em disco e alguns arquivos bastam —
veja `packages/core/test/graph/` para o padrão usado nos adapters embutidos.
