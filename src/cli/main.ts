#!/usr/bin/env node
import { SpecrunError } from '../errors.js';
import { createProgram } from './program.js';

try {
  await createProgram().parseAsync(process.argv);
} catch (error) {
  // SpecrunError.message already carries the details, one per line.
  const message =
    error instanceof SpecrunError || error instanceof Error ? error.message : String(error);
  process.stderr.write(`specrun: ${message}\n`);
  process.exitCode = 1;
}
