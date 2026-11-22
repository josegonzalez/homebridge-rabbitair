import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

import * as hap from '@homebridge/hap-nodejs';
import type { API, Logging, PlatformAccessory } from 'homebridge';

import { PurifierAccessory, type AccessoryContext } from './accessory.js';
import { HK } from './mapping.js';
import { Command, RabbitAirClient, type RawState } from './sdk/index.js';
import type { DeviceConfig } from './settings.js';
import { FakeDevice, minusA2State, TEST_TOKEN } from './test/fake-device.js';

const { Service: S, Characteristic: C } = hap;

class FakePlatformAccessory extends hap.Accessory {
  context: Partial<AccessoryContext> = {};
}

const api = { hap } as unknown as API;
const messages: string[] = [];
const log = Object.assign((m: string) => messages.push(m), {
  info: (m: string) => messages.push(`info: ${m}`),
  warn: (m: string) => messages.push(`warn: ${m}`),
  error: (m: string) => messages.push(`error: ${m}`),
  debug: () => {},
  success: (m: string) => messages.push(m),
  log: () => {},
  prefix: 'test',
}) as unknown as Logging;

const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach((f) => f()));

interface Harness {
  device: FakeDevice;
  accessory: FakePlatformAccessory;
  purifier: PurifierAccessory;
  poll: () => Promise<void>;
  writes: () => Record<string, unknown>[];
}

async function harness(config: Partial<DeviceConfig> = {}, state?: RawState): Promise<Harness> {
  const device = await new FakeDevice({ state }).start();
  const client = new RabbitAirClient({ host: '127.0.0.1', port: device.port, token: TEST_TOKEN, timeoutMs: 100, retries: 1 });
  const accessory = new FakePlatformAccessory('Kitchen', hap.uuid.generate('test'));
  accessory.context = { device: { name: 'Kitchen', token: TEST_TOKEN, ...config } };
  const purifier = new PurifierAccessory(
    { api, log, pollIntervalMs: 60_000, airQualityScale: 'higherIsBetter', discovery: false, save: () => {} },
    accessory as unknown as PlatformAccessory<AccessoryContext>,
    client,
  );
  cleanup.push(() => {
    purifier.stop();
    device.stop();
  });
  const poll = () => (purifier as unknown as { poll: () => Promise<void> }).poll();
  await poll();
  return {
    device,
    accessory,
    purifier,
    poll,
    writes: () => device.requests.filter((r) => r.cmd === Command.State && r.data).map((r) => r.data as Record<string, unknown>),
  };
}

const value = (svc: hap.Service | undefined, c: typeof hap.Characteristic & { UUID: string }) => svc!.getCharacteristic(c as never).value;

describe('PurifierAccessory with a MinusA2', () => {
  it('exposes every supported service with values from the device', async () => {
    const { accessory } = await harness();
    const purifier = accessory.getService(S.AirPurifier);
    assert.ok(purifier);
    assert.equal(value(purifier, C.Active), HK.Active.ACTIVE);
    assert.equal(value(purifier, C.CurrentAirPurifierState), HK.CurrentAirPurifierState.PURIFYING_AIR);
    assert.equal(value(purifier, C.TargetAirPurifierState), HK.TargetAirPurifierState.MANUAL);
    assert.equal(value(purifier, C.RotationSpeed), 20);
    assert.equal(purifier.testCharacteristic(C.LockPhysicalControls), false, 'MinusA2 does not report a child lock');

    assert.equal(value(accessory.getService(S.AirQualitySensor), C.AirQuality), HK.AirQuality.GOOD);
    assert.equal(value(accessory.getService(S.AirQualitySensor), C.StatusFault), HK.StatusFault.NO_FAULT);
    const filter = accessory.getService(S.FilterMaintenance);
    assert.equal(value(filter, C.FilterLifeLevel), 21);
    assert.equal(value(filter, C.FilterChangeIndication), HK.FilterChangeIndication.FILTER_OK);
    assert.ok(purifier.linkedServices.includes(filter!), 'filter is linked to the purifier');

    const switches = Object.fromEntries(accessory.services.filter((s) => s.UUID === S.Switch.UUID).map((s) => [s.subtype, s.getCharacteristic(C.On).value]));
    assert.deepEqual(switches, { ionizer: false, pollen: false, moodlight: true, lights: true });

    const info = accessory.getService(S.AccessoryInformation)!;
    assert.equal(info.getCharacteristic(C.Manufacturer).value, 'Rabbit Air');
    assert.equal(info.getCharacteristic(C.Model).value, 'MinusA2');
    assert.equal(info.getCharacteristic(C.SerialNumber).value, 'AC67B2D2689C');
    assert.equal(info.getCharacteristic(C.FirmwareRevision).value, '2.4.4');
  });

  it('answers HomeKit reads from the cache without network requests', async () => {
    const { accessory, device } = await harness();
    const before = device.requests.length;
    const purifier = accessory.getService(S.AirPurifier)!;
    for (let i = 0; i < 5; i++) {
      assert.equal(await purifier.getCharacteristic(C.RotationSpeed).handleGetRequest(), 20);
      assert.equal(await purifier.getCharacteristic(C.Active).handleGetRequest(), HK.Active.ACTIVE);
    }
    assert.equal(device.requests.length, before);
  });

  it('coalesces simultaneous writes into one command and updates the cache', async () => {
    const { accessory, writes } = await harness();
    const purifier = accessory.getService(S.AirPurifier)!;
    await Promise.all([
      purifier.getCharacteristic(C.Active).handleSetRequest(HK.Active.ACTIVE),
      purifier.getCharacteristic(C.RotationSpeed).handleSetRequest(100),
      purifier.getCharacteristic(C.TargetAirPurifierState).handleSetRequest(HK.TargetAirPurifierState.MANUAL),
    ]);
    assert.deepEqual(writes(), [{ power: true, speed: 5, mode: 2 }]);
    assert.equal(await purifier.getCharacteristic(C.RotationSpeed).handleGetRequest(), 100);
  });

  it('drives the switches', async () => {
    const { accessory, writes } = await harness();
    const sw = (subtype: string) => accessory.getServiceById(S.Switch, subtype)!.getCharacteristic(C.On);
    await sw('ionizer').handleSetRequest(true);
    await sw('pollen').handleSetRequest(true);
    await sw('moodlight').handleSetRequest(false);
    await sw('lights').handleSetRequest(false);
    assert.deepEqual(writes(), [{ ionizer: true }, { power: true, mode: 1 }, { moodlight: 0 }, { all_light_off: 0 }]);
    assert.equal(await sw('pollen').handleGetRequest(), true);
    assert.equal(
      await accessory.getService(S.AirPurifier)!.getCharacteristic(C.TargetAirPurifierState).handleGetRequest(),
      HK.TargetAirPurifierState.MANUAL,
    );
  });

  it('resets the filter life to the nominal life', async () => {
    const { accessory, writes } = await harness({}, { ...minusA2State(), filter_replacement: true });
    const filter = accessory.getService(S.FilterMaintenance)!;
    await filter.getCharacteristic(C.ResetFilterIndication).handleSetRequest(1);
    assert.deepEqual(writes(), [{ filter_life: 525600, filter_replacement: false }]);
    assert.equal(filter.getCharacteristic(C.FilterLifeLevel).value, 100);
    assert.equal(filter.getCharacteristic(C.FilterChangeIndication).value, HK.FilterChangeIndication.FILTER_OK);
  });

  it('reports No Response after repeated failures and recovers', async () => {
    const { accessory, device, poll } = await harness();
    const active = accessory.getService(S.AirPurifier)!.getCharacteristic(C.Active);
    device.drop = 1000;
    await poll();
    assert.equal(await active.handleGetRequest(), HK.Active.ACTIVE, 'one failure still serves the cache');
    await poll();
    await assert.rejects(active.handleGetRequest(), (err: unknown) => err === hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    assert.ok(messages.some((m) => m.startsWith('warn: [Kitchen] not responding')));
    device.drop = 0;
    await poll();
    assert.equal(await active.handleGetRequest(), HK.Active.ACTIVE);
    assert.ok(messages.some((m) => m === 'info: [Kitchen] responding again'));
  });

  it('keeps polling without duplicating services and pushes changes', async () => {
    const { accessory, device, poll } = await harness();
    const count = accessory.services.length;
    device.state.speed = 4;
    device.state.ionizer = true;
    await poll();
    await poll();
    assert.equal(accessory.services.length, count);
    assert.ok(messages.every((m) => !m.includes('same UUID')));
    assert.equal(accessory.getService(S.AirPurifier)!.getCharacteristic(C.RotationSpeed).value, 80);
    assert.equal(accessory.getServiceById(S.Switch, 'ionizer')!.getCharacteristic(C.On).value, true);
  });

  it('reuses services restored from the Homebridge cache', async () => {
    const first = await harness();
    first.purifier.stop();
    const count = first.accessory.services.length;

    // A restart: a new accessory handler on the cached accessory object.
    const device = await new FakeDevice().start();
    const client = new RabbitAirClient({ host: '127.0.0.1', port: device.port, token: TEST_TOKEN, timeoutMs: 100, retries: 1 });
    const restored = new PurifierAccessory(
      { api, log, pollIntervalMs: 60_000, airQualityScale: 'higherIsBetter', discovery: false, save: () => {} },
      first.accessory as unknown as PlatformAccessory<AccessoryContext>,
      client,
    );
    cleanup.push(() => {
      restored.stop();
      device.stop();
    });
    await (restored as unknown as { poll: () => Promise<void> }).poll();
    await (restored as unknown as { poll: () => Promise<void> }).poll();
    assert.equal(first.accessory.services.length, count);

    await first.accessory.getServiceById(S.Switch, 'ionizer')!.getCharacteristic(C.On).handleSetRequest(true);
    assert.deepEqual(device.requests.filter((r) => r.data).map((r) => r.data), [{ ionizer: true }]);
  });

  it('removes services that are turned off in the configuration', async () => {
    const { accessory } = await harness({ ionizerSwitch: false, airQualitySensor: false, moodLightSwitch: false });
    assert.equal(accessory.getService(S.AirQualitySensor), undefined);
    assert.equal(accessory.getServiceById(S.Switch, 'ionizer'), undefined);
    assert.equal(accessory.getServiceById(S.Switch, 'moodlight'), undefined);
    assert.ok(accessory.getServiceById(S.Switch, 'pollen'));
  });
});

describe('PurifierAccessory with an A3', () => {
  it('adds the child lock and leaves out Pollen mode', async () => {
    const { accessory, writes } = await harness({}, { ...minusA2State(), model: 3, lock: false, idle: 1 });
    const purifier = accessory.getService(S.AirPurifier)!;
    assert.equal(purifier.getCharacteristic(C.LockPhysicalControls).value, HK.LockPhysicalControls.DISABLED);
    assert.equal(purifier.getCharacteristic(C.CurrentAirPurifierState).value, HK.CurrentAirPurifierState.IDLE);
    assert.equal(accessory.getServiceById(S.Switch, 'pollen'), undefined);
    await purifier.getCharacteristic(C.LockPhysicalControls).handleSetRequest(HK.LockPhysicalControls.ENABLED);
    assert.deepEqual(writes(), [{ lock: true }]);
  });
});
