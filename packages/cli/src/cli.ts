/**
 * Ponto de entrada da CLI: registro de comandos, ajuda e despacho.
 * @packageDocumentation
 */

import { parseArgs, formatFlagHelp, type FlagSpecs } from './args.js';
import {
  EXIT,
  GLOBAL_FLAGS,
  processOutput,
  reportError,
  type Command,
  type OutputChannel,
} from './context.js';
import { doctorCommand } from './commands/doctor.js';
import { initCommand } from './commands/init.js';
import { runCommand } from './commands/run.js';
import { startCommand } from './commands/start.js';
import { statusCommand } from './commands/status.js';
import { stopCommand } from './commands/stop.js';
import { watchCommand } from './commands/watch.js';
import { whyCommand } from './commands/why.js';

/** Versao publicada da CLI. */
export const CLI_VERSION = '0.1.0';

/** Todos os comandos, na ordem em que aparecem na ajuda. */
export const COMMANDS: readonly Command[] = [
  startCommand,
  runCommand,
  whyCommand,
  statusCommand,
  watchCommand,
  stopCommand,
  initCommand,
  doctorCommand,
];

/** Localiza um comando pelo nome. */
export function findCommand(name: string): Command | undefined {
  return COMMANDS.find((command) => command.name === name);
}

/** Ajuda geral. */
export function generalHelp(): string[] {
  const width = Math.max(...COMMANDS.map((command) => command.name.length));
  return [
    'livetest — roda os testes afetados a cada save, em tempo real.',
    '',
    'Uso: livetest <comando> [opcoes]',
    '',
    'Comandos:',
    ...COMMANDS.map((command) => `  ${command.name.padEnd(width + 3)}${command.summary}`),
    '',
    'Opcoes globais:',
    ...formatFlagHelp(GLOBAL_FLAGS),
    '',
    'Detalhes de um comando: livetest <comando> --help',
  ];
}

/** Ajuda de um comando. */
export function commandHelp(command: Command): string[] {
  const lines = [command.summary, '', `Uso: ${command.usage}`, ''];
  const specs: FlagSpecs = { ...command.flags, ...GLOBAL_FLAGS };
  if (Object.keys(specs).length > 0) {
    lines.push('Opcoes:', ...formatFlagHelp(specs));
  }
  if (command.details && command.details.length > 0) {
    lines.push('', ...command.details);
  }
  return lines;
}

/** Opcoes de {@link runCli}. */
export interface RunCliOptions {
  /** Argumentos ja sem `node` e sem o caminho do script. */
  argv: readonly string[];
  output?: OutputChannel;
  cwd?: string;
}

/**
 * Executa a CLI e devolve o codigo de saida.
 *
 * Nao chama `process.exit`: quem chama decide o que fazer, o que torna a funcao
 * testavel de ponta a ponta.
 *
 * @example
 * ```ts
 * const code = await runCli({ argv: ['why', 'src/login.ts'] });
 * ```
 */
export async function runCli(options: RunCliOptions): Promise<number> {
  const output = options.output ?? processOutput;
  const cwd = options.cwd ?? process.cwd();
  const argv = [...options.argv];

  if (argv.length === 0) {
    for (const line of generalHelp()) output.out(line);
    return EXIT.ok;
  }

  const first = argv[0] as string;

  if (first === '--version' || first === '-v') {
    output.out(CLI_VERSION);
    return EXIT.ok;
  }
  if (first === '--help' || first === '-h' || first === 'help') {
    const target = argv[1] ? findCommand(argv[1]) : undefined;
    for (const line of target ? commandHelp(target) : generalHelp()) output.out(line);
    return EXIT.ok;
  }

  const command = findCommand(first);
  if (!command) {
    output.err(`Comando desconhecido: ${first}`);
    output.err('Rode `livetest --help` para ver os comandos disponiveis.');
    return EXIT.usage;
  }

  const parsed = parseArgs(argv.slice(1), { ...command.flags, ...GLOBAL_FLAGS });

  if (parsed.values['help'] === true) {
    for (const line of commandHelp(command)) output.out(line);
    return EXIT.ok;
  }
  if (parsed.errors.length > 0) {
    for (const error of parsed.errors) output.err(error);
    output.err(`Uso: ${command.usage}`);
    return EXIT.usage;
  }

  try {
    return await command.run({
      positionals: parsed.positionals,
      flags: parsed.values,
      output,
      cwd,
    });
  } catch (error) {
    return reportError(error, output);
  }
}
