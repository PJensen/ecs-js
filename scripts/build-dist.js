import { cp, mkdir, rm } from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), '..');
const distDir = path.join(projectRoot, 'dist');

const entriesToCopy = [
  'index.js',
  'core.js',
  'systems.js',
  'hierarchy.js',
  'serialization.js',
  'crossWorld.js',
  'archetype.js',
  'rng.js',
  'scripts.js',
  'scriptsPhasesExtra.js',
  'adapters',
  'ecs.d.ts'
];

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

for (const entry of entriesToCopy) {
  const source = path.join(projectRoot, entry);
  const destination = path.join(distDir, entry);
  await cp(source, destination, { recursive: true });
}

// Include top-level docs for npm consumers.
for (const doc of ['README.md', 'LICENSE']) {
  const source = path.join(projectRoot, doc);
  const destination = path.join(distDir, doc);
  await cp(source, destination);
}

console.log('Built dist/ with library modules and docs.');
