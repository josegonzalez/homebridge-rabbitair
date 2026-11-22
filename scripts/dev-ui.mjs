// Runs a throwaway Homebridge with the Homebridge UI and this working copy of
// the plugin, for trying the settings page. Everything lives in
// tmp/dev-homebridge (gitignored) and both servers only listen on 127.0.0.1.
//
//   npm run build && node scripts/dev-ui.mjs
//
// The UI keeps its login: on first start, open the printed URL and create an
// admin account in the UI's setup screen. The config only holds the bridge and
// the UI itself; set the plugin up through its settings page. Edits made in the
// UI are kept between runs. Set DEV_UI_PORT to change the port (default 8592).
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const dir = join(root, 'tmp', 'dev-homebridge');
const tooling = join(dir, 'tooling');
const plugins = join(dir, 'plugins');
const port = Number(process.env.DEV_UI_PORT ?? 8592);
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

if (!existsSync(join(root, 'dist', 'index.js'))) {
  console.error('dev-ui: build the plugin first with: npm run build');
  process.exit(1);
}

// Homebridge and the UI are installed here rather than as dev dependencies,
// so the plugin's own dependency tree stays small.
if (!existsSync(join(tooling, 'node_modules', 'homebridge-config-ui-x'))) {
  mkdirSync(tooling, { recursive: true });
  console.log('dev-ui: installing homebridge and homebridge-config-ui-x into tmp/dev-homebridge/tooling');
  execFileSync(npm, ['install', '--prefix', tooling, '--no-audit', '--no-fund', '--ignore-scripts', 'homebridge', 'homebridge-config-ui-x'], {
    stdio: 'inherit',
  });
}

const link = (target, path) => {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    symlinkSync(target, path, 'dir');
  }
};
link(root, join(plugins, ...pkg.name.split('/')));
link(join(tooling, 'node_modules', 'homebridge-config-ui-x'), join(plugins, 'homebridge-config-ui-x'));

const configPath = join(dir, 'config.json');
if (!existsSync(configPath)) {
  const mac = Array.from(randomBytes(6), (b, i) => (i === 0 ? (b & 0xfe) | 0x02 : b).toString(16).padStart(2, '0'))
    .join(':')
    .toUpperCase();
  const pin = () => String(randomInt(0, 1000)).padStart(3, '0');
  const config = {
    bridge: {
      name: 'Homebridge Dev',
      username: mac,
      port: randomInt(51000, 52000),
      pin: `${pin()}-${pin().slice(0, 2)}-${pin()}`,
      // The loopback interface, so HomeKit clients on the network cannot reach the bridge.
      bind: [process.platform === 'darwin' ? 'lo0' : 'lo'],
    },
    platforms: [{ platform: 'config', name: 'Config', port, host: '127.0.0.1' }],
  };
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`dev-ui: wrote ${configPath}`);
}

// The UI server runs as its own process (hb-service normally starts it), next
// to Homebridge itself. Plugin settings pages work the same way; restarting
// Homebridge from the UI does not, so restart this script instead.
const homebridge = join(tooling, 'node_modules', 'homebridge', 'bin', 'homebridge');
const ui = join(tooling, 'node_modules', 'homebridge-config-ui-x', 'dist', 'bin', 'standalone.js');
const children = [
  spawn(process.execPath, [homebridge, '-D', '-U', dir, '-P', plugins, '--strict-plugin-resolution'], { stdio: 'inherit' }),
  spawn(process.execPath, [ui, '-U', dir, '-P', plugins], { stdio: 'inherit', env: { ...process.env, UIX_STRICT_PLUGIN_RESOLUTION: '1' } }),
];
console.log(`dev-ui: Homebridge UI at http://127.0.0.1:${port} (Ctrl-C to stop)`);
const stop = () => children.forEach((c) => c.exitCode === null && c.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const c of children) {
  c.on('exit', (code) => {
    stop();
    process.exitCode = code ?? 0;
  });
}
