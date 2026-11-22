// Compiles the TypeScript sources and copies the settings UI page into dist.
import { execFileSync } from 'node:child_process';
import { cpSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

rmSync('dist', { recursive: true, force: true });
execFileSync(process.execPath, [require.resolve('typescript/bin/tsc'), '-p', 'tsconfig.json'], { stdio: 'inherit' });
cpSync('src/homebridge-ui/public', 'dist/homebridge-ui/public', { recursive: true });
