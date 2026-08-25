/**
 * Parser de argumentos de linha de comando.
 *
 * Escrito a mao em vez de usar uma biblioteca por tres razoes: o pacote roda
 * como `devDependency` em projetos alheios (menos dependencia = menos conflito),
 * as mensagens de erro ficam em portugues, e o resultado e totalmente tipado a
 * partir da especificacao das flags.
 *
 * Formas aceitas: `--flag`, `--flag=valor`, `--flag valor`, `--no-flag`,
 * aliases de uma letra (`-c`) e `--` para encerrar as flags.
 *
 * @packageDocumentation
 */

/** Tipo de valor de uma flag. */
export type FlagType = 'string' | 'boolean' | 'number' | 'string[]';

/** Especificacao de uma flag. */
export interface FlagSpec {
  type: FlagType;
  /** Alias de uma letra, sem hifen. */
  alias?: string;
  /** Texto exibido no `--help`. */
  description: string;
  /** Nome do valor no `--help`, ex.: `caminho`. */
  valueName?: string;
}

/** Conjunto de flags de um comando. */
export type FlagSpecs = Readonly<Record<string, FlagSpec>>;

/** Valor ja convertido de uma flag. */
export type FlagValue = string | boolean | number | string[];

/** Resultado do parsing. */
export interface ParsedArgs {
  /** Valores das flags informadas (ausentes nao aparecem). */
  values: Record<string, FlagValue>;
  /** Argumentos posicionais, na ordem. */
  positionals: string[];
  /** Problemas encontrados; a CLI aborta se houver algum. */
  errors: string[];
}

/** Localiza a flag pelo nome longo ou pelo alias. */
function findSpec(specs: FlagSpecs, token: string): [string, FlagSpec] | null {
  const direct = specs[token];
  if (direct) return [token, direct];
  for (const [name, spec] of Object.entries(specs)) {
    if (spec.alias === token) return [name, spec];
  }
  return null;
}

/** Converte o texto bruto para o tipo declarado. */
function coerce(
  name: string,
  spec: FlagSpec,
  raw: string,
  current: FlagValue | undefined,
  errors: string[],
): FlagValue {
  if (spec.type === 'number') {
    const value = Number(raw);
    if (!Number.isFinite(value)) {
      errors.push(`--${name} espera um numero, recebeu "${raw}".`);
      return Number.NaN;
    }
    return value;
  }
  if (spec.type === 'string[]') {
    const list = Array.isArray(current) ? current : [];
    return [...list, raw];
  }
  return raw;
}

/**
 * Faz o parsing de `argv` segundo a especificacao de flags.
 *
 * @param argv - Argumentos ja sem `node` e sem o caminho do script.
 * @param specs - Flags aceitas pelo comando.
 *
 * @example
 * ```ts
 * parseArgs(['--depth', 'transitive', 'src/a.ts'], {
 *   depth: { type: 'string', description: 'profundidade' },
 * });
 * // { values: { depth: 'transitive' }, positionals: ['src/a.ts'], errors: [] }
 * ```
 */
export function parseArgs(argv: readonly string[], specs: FlagSpecs): ParsedArgs {
  const values: Record<string, FlagValue> = {};
  const positionals: string[] = [];
  const errors: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string;

    if (token === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }

    if (!token.startsWith('-') || token === '-') {
      positionals.push(token);
      continue;
    }

    const isLong = token.startsWith('--');
    const body = token.slice(isLong ? 2 : 1);
    const [rawName, inlineValue] = splitOnce(body, '=');

    // `--no-flag` desliga uma flag booleana.
    if (isLong && rawName.startsWith('no-')) {
      const negated = findSpec(specs, rawName.slice(3));
      if (negated && negated[1].type === 'boolean') {
        values[negated[0]] = false;
        continue;
      }
    }

    const found = findSpec(specs, rawName);
    if (!found) {
      errors.push(`Opcao desconhecida: ${token}`);
      continue;
    }
    const [name, spec] = found;

    if (spec.type === 'boolean') {
      if (inlineValue !== undefined) {
        values[name] = inlineValue !== 'false' && inlineValue !== '0';
      } else {
        values[name] = true;
      }
      continue;
    }

    let raw = inlineValue;
    if (raw === undefined) {
      const next = argv[i + 1];
      if (next === undefined || (next.startsWith('-') && next !== '-')) {
        errors.push(`--${name} espera um valor.`);
        continue;
      }
      raw = next;
      i++;
    }
    values[name] = coerce(name, spec, raw, values[name], errors);
  }

  return { values, positionals, errors };
}

/** Divide na primeira ocorrencia do separador. */
function splitOnce(text: string, separator: string): [string, string | undefined] {
  const index = text.indexOf(separator);
  if (index === -1) return [text, undefined];
  return [text.slice(0, index), text.slice(index + 1)];
}

/**
 * Formata a secao de opcoes do `--help`.
 *
 * @example
 * ```text
 *   -c, --config <caminho>   Caminho do arquivo de configuracao
 * ```
 */
export function formatFlagHelp(specs: FlagSpecs): string[] {
  const entries = Object.entries(specs).map(([name, spec]) => {
    const alias = spec.alias ? `-${spec.alias}, ` : '    ';
    const value =
      spec.type === 'boolean' ? '' : ` <${spec.valueName ?? (spec.type === 'number' ? 'n' : 'valor')}>`;
    return [`  ${alias}--${name}${value}`, spec.description] as const;
  });
  const width = Math.max(...entries.map(([left]) => left.length), 0);
  return entries.map(([left, right]) => `${left.padEnd(width + 3)}${right}`);
}
