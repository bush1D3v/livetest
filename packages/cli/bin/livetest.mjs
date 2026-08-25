#!/usr/bin/env node
/**
 * Shim executavel do `livetest`.
 *
 * Mantido minimo de proposito: toda a logica vive em `dist/cli.js`, que e
 * testavel sem criar um processo.
 */

import { runCli } from '../dist/cli.js';

const exitCode = await runCli({ argv: process.argv.slice(2) });
process.exitCode = exitCode;
