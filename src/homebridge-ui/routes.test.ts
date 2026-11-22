import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { RequestError } from '@homebridge/plugin-ui-utils';

import { FakeDevice, TEST_TOKEN } from '../test/fake-device.js';
import { verifyDevice } from './routes.js';

describe('settings UI routes', () => {
  let device: FakeDevice;
  before(async () => {
    device = await new FakeDevice().start();
  });
  after(() => device.stop());

  it('verifies a working key and reports the device identity', async () => {
    const result = await verifyDevice({ host: `127.0.0.1:${device.port}`, token: TEST_TOKEN });
    assert.deepEqual(result, { mac: 'AC67B2D2689C', thingId: 'thing', model: 'MinusA2', firmware: '2.4.4' });
  });

  it('flags a key the device does not accept', async () => {
    await assert.rejects(
      verifyDevice({ host: `127.0.0.1:${device.port}`, token: 'f'.repeat(32) }),
      (err: unknown) => err instanceof RequestError && (err.requestError as { code: string }).code === 'rejected',
    );
  });

  it('checks the key format before contacting the device', async () => {
    const before = device.requests.length;
    await assert.rejects(
      verifyDevice({ host: `127.0.0.1:${device.port}`, token: 'not-a-key' }),
      (err: unknown) => err instanceof RequestError && (err.requestError as { code: string }).code === 'token-format',
    );
    assert.equal(device.requests.length, before);
  });
});
