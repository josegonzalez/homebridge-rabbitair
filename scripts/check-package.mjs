// Checks the built package before it is published: the files Homebridge needs
// are present, nothing unwanted is shipped, and the plugin and SDK load.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const fail = (message) => {
  console.error(`check-package: ${message}`);
  process.exit(1);
};

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));
const schema = JSON.parse(readFileSync('config.schema.json', 'utf8'));

if (!pkg.keywords?.includes('homebridge-plugin')) fail('package.json needs the "homebridge-plugin" keyword');
if (!pkg.engines?.homebridge || !pkg.engines?.node) fail('package.json needs engines.homebridge and engines.node');
if (!/^(@[^/]+\/)?homebridge-/.test(pkg.name)) fail('package name must start with homebridge- (optionally scoped)');
if (schema.pluginAlias !== 'RabbitAirLocal' || schema.pluginType !== 'platform') fail('config.schema.json alias or type is wrong');
if (!schema.customUi) fail('config.schema.json must enable the custom UI');

// Published packages must not run anything when installed. "prepare" is
// allowed in the repository for git installs and removed before release.
const installScripts = ['preinstall', 'install', 'postinstall', 'prepare'].filter((s) => pkg.scripts?.[s]);
const allowed = process.argv.includes('--release') ? [] : ['prepare'];
const forbidden = installScripts.filter((s) => !allowed.includes(s));
if (forbidden.length) fail(`install-time scripts must not be published: ${forbidden.join(', ')}`);

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const [pack] = JSON.parse(execFileSync(npm, ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' }));
const files = pack.files.map((f) => f.path);
const required = [
  'package.json',
  'config.schema.json',
  'LICENSE',
  'NOTICE',
  'README.md',
  'dist/index.js',
  'dist/sdk/index.js',
  'dist/sdk/index.d.ts',
  `${schema.customUiPath.replace(/^\.\//, '')}/server.js`,
  `${schema.customUiPath.replace(/^\.\//, '')}/public/index.html`,
];
const missing = required.filter((f) => !files.includes(f));
const unwanted = files.filter((f) => /\.test\.|^dist\/test\/|^src\/|^\.github\/|^scripts\/|^tmp\//.test(f));
if (missing.length) fail(`missing from package: ${missing.join(', ')}`);
if (unwanted.length) fail(`should not be packaged: ${unwanted.join(', ')}`);

const plugin = await import(pathToFileURL('dist/index.js').href);
if (typeof plugin.default !== 'function') fail('dist/index.js must default-export the plugin initializer');
let registered;
plugin.default({ registerPlatform: (name) => (registered = name) });
if (registered !== schema.pluginAlias) fail(`plugin registered "${registered}", expected "${schema.pluginAlias}"`);

const sdk = await import(pathToFileURL('dist/sdk/index.js').href);
for (const name of ['RabbitAirClient', 'discover', 'findDevice', 'parseState', 'encodeUpdate']) {
  if (typeof sdk[name] !== 'function') fail(`SDK is missing ${name}`);
}

const deps = Object.keys(pkg.dependencies ?? {});
console.log(`check-package: ok (${files.length} files, ${pack.size} bytes, runtime dependencies: ${deps.join(', ') || 'none'})`);
