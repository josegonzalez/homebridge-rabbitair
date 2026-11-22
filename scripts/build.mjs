// Compiles the TypeScript sources and copies the settings UI page into dist.
import { execFileSync } from 'node:child_process';
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);

// Find tsc through the package's "bin" entry: TypeScript 7 does not export
// its bin/ files, so they cannot be resolved directly.
const tsPackage = require.resolve('typescript/package.json');
const tsc = join(dirname(tsPackage), JSON.parse(readFileSync(tsPackage, 'utf8')).bin.tsc);

rmSync('dist', { recursive: true, force: true });
execFileSync(process.execPath, [tsc, '-p', 'tsconfig.json'], { stdio: 'inherit' });
cpSync('src/homebridge-ui/public', 'dist/homebridge-ui/public', { recursive: true });
