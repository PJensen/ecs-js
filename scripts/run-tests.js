import { readdirSync } from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';

const testsDir = path.resolve('tests');
const testFiles = readdirSync(testsDir)
  .filter((file) => file.endsWith('.mjs'))
  .map((file) => path.join(testsDir, file));

for (const file of testFiles) {
  console.log(`Running ${file}`);
  const result = spawnSync(process.execPath, [file], { stdio: 'inherit' });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log(`Executed ${testFiles.length} test files.`);
