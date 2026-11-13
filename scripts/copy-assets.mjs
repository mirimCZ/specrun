// Copies non-TypeScript files the package reads at runtime from src/ to dist/ (after tsc).
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ASSETS = ['session/protocol.md', 'review/reviewPrompt.md'];

const root = join(import.meta.dirname, '..');
for (const asset of ASSETS) {
  const target = join(root, 'dist', asset);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(root, 'src', asset), target);
}
