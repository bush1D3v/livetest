/**
 * API programatica da CLI do Live Test Runner.
 *
 * Exposta para permitir embutir a CLI em outra ferramenta (um script de build,
 * um plugin de editor) sem precisar criar um processo.
 *
 * @example
 * ```ts
 * import { runCli } from '@livetest/cli';
 * const exitCode = await runCli({ argv: ['run', 'src/login.ts'] });
 * ```
 *
 * @packageDocumentation
 */

export { CLI_VERSION, COMMANDS, commandHelp, findCommand, generalHelp, runCli } from './cli.js';
export type { RunCliOptions } from './cli.js';
export { formatFlagHelp, parseArgs } from './args.js';
export type { FlagSpec, FlagSpecs, FlagType, FlagValue, ParsedArgs } from './args.js';
export {
  CONFIG_OVERRIDE_FLAGS,
  EXIT,
  GLOBAL_FLAGS,
  buildOverrides,
  parseDepthFlag,
  processOutput,
} from './context.js';
export type { Command, CommandContext, OutputChannel } from './context.js';
