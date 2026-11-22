import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import { FakeDevice, TEST_TOKEN } from '../test/fake-device.js';
import { decrypt, encrypt, parseToken } from './crypto.js';
import {
  Command,
  Mode,
  Model,
  normalizeHost,
  ProtocolError,
  RabbitAirClient,
  Speed,
  TimeoutError,
  type ClientOptions,
} from './index.js';

const devices: FakeDevice[] = [];
const clients: RabbitAirClient[] = [];

afterEach(() => {
  clients.splice(0).forEach((c) => c.close());
  devices.splice(0).forEach((d) => d.stop());
});

async function setup(device: FakeDevice, options: Partial<ClientOptions> = {}) {
  devices.push(await device.start());
  const client = new RabbitAirClient({
    host: '127.0.0.1',
    port: device.port,
    token: TEST_TOKEN,
    timeoutMs: 200,
    ...options,
  });
  clients.push(client);
  return client;
}

describe('crypto', () => {
  it('round trips messages of every length', () => {
    const key = parseToken(TEST_TOKEN);
    for (const len of [0, 1, 15, 16, 17, 100]) {
      const msg = Buffer.alloc(len, 'x');
      const enc = encrypt(key, msg);
      assert.equal(enc.length % 16, 0);
      assert.deepEqual(decrypt(key, enc), msg);
    }
  });

  it('rejects bad tokens', () => {
    for (const t of ['', 'abc', 'z'.repeat(32), TEST_TOKEN + '00']) {
      assert.throws(() => parseToken(t));
    }
  });

  it('rejects messages from a different key', () => {
    const enc = encrypt(parseToken(TEST_TOKEN), Buffer.from('{"id":1}'));
    assert.throws(() => decrypt(parseToken('f'.repeat(32)), enc));
  });
});

describe('normalizeHost', () => {
  it('appends .local to bare device IDs only', () => {
    assert.equal(normalizeHost('abc123'), 'abc123.local');
    assert.equal(normalizeHost('abc123.local'), 'abc123.local');
    assert.equal(normalizeHost('192.168.1.188'), '192.168.1.188');
    assert.equal(normalizeHost('localhost'), 'localhost');
  });
});

for (const transport of ['udp', 'tcp'] as const) {
  describe(`RabbitAirClient over ${transport}`, () => {
    it('reads state and syncs the timestamp once', async () => {
      const device = new FakeDevice({ transport });
      const client = await setup(device, { transport });

      const state = await client.getState();
      assert.equal(state.model, Model.MinusA2);
      assert.equal(state.mode, Mode.Manual);
      assert.equal(state.speed, Speed.Silent);
      assert.equal(state.mainFirmware, '3');
      assert.equal(state.wifiFirmware, '2.4.4');
      assert.equal(state.lights, 1);
      await client.getState();

      assert.equal(device.requests.length, 3);
      assert.equal(device.requests[0]!.cmd, Command.Timestamp);
      for (const r of device.requests.slice(1)) {
        assert.ok((r.ts as number) >= 1000, 'requests carry the synced timestamp');
      }
    });

    it('writes only the given fields with wire names', async () => {
      const device = new FakeDevice({ transport });
      const client = await setup(device, { transport });
      await client.setState({ power: false, speed: Speed.Turbo, lights: 0, childLock: true });
      assert.deepEqual(device.requests.at(-1)!.data, { power: false, speed: 5, all_light_off: 0, lock: true });
    });

    it('raises protocol errors without dropping the connection', async () => {
      const device = new FakeDevice({ transport });
      device.rejectWrites = 1;
      const client = await setup(device, { transport });
      await assert.rejects(client.setState({ power: true }), ProtocolError);
      await client.getState();
      assert.equal(device.requests.filter((r) => r.cmd === Command.Timestamp).length, 1);
    });

    it('serializes concurrent requests', async () => {
      const device = new FakeDevice({ transport });
      const client = await setup(device, { transport });
      const results = await Promise.all([client.getState(), client.getInfo(), client.getState()]);
      assert.equal(results[1]!.mac, 'AC:67:B2:D2:68:9C');
      assert.equal(device.requests.filter((r) => r.cmd === Command.Timestamp).length, 1);
    });
  });
}

describe('RabbitAirClient over udp', () => {
  it('retries lost packets', async () => {
    const client = await setup(new FakeDevice({ drop: 2 }));
    await client.getState();
  });

  it('times out and recovers with a fresh sync', async () => {
    const device = new FakeDevice({ drop: 100 });
    const client = await setup(device, { timeoutMs: 50, retries: 2 });
    await assert.rejects(client.getState(), (err: Error) => err instanceof TimeoutError && /after 2 attempts/.test(err.message));
    device.drop = 0;
    await client.getState();
    assert.equal(device.requests.filter((r) => r.cmd === Command.Timestamp).length, 3);
  });

  it('validates updates before sending', async () => {
    const device = new FakeDevice();
    const client = await setup(device);
    await assert.rejects(client.setState({}), RangeError);
    await assert.rejects(client.setState({ speed: Speed.SuperSilent }), RangeError);
    await assert.rejects(client.setState({ timer: 2000 }), RangeError);
    await assert.rejects(client.setState({ schedule: '123' }), RangeError);
    await assert.rejects(client.setState({ color: [1, 2] }), RangeError);
    assert.equal(device.requests.length, 0);
  });

  it('rejects requests after close', async () => {
    const client = await setup(new FakeDevice());
    client.close();
    await assert.rejects(client.getState());
  });
});

describe('splitHostPort', () => {
  it('splits ports from hosts', async () => {
    const { splitHostPort } = await import('./index.js');
    assert.deepEqual(splitHostPort('192.168.1.188:9010'), ['192.168.1.188', 9010]);
    assert.deepEqual(splitHostPort('192.168.1.188'), ['192.168.1.188', undefined]);
    assert.deepEqual(splitHostPort('[fe80::1]:9009'), ['fe80::1', 9009]);
    assert.deepEqual(splitHostPort('fe80::1'), ['fe80::1', undefined]);
  });
});
