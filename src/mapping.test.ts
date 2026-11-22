import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import * as map from './mapping.js';
import { HK } from './mapping.js';
import { Lights, Mode, Model, Moodlight, parseState, Speed, type RawState } from './sdk/index.js';
import { minusA2State } from './test/fake-device.js';

const state = (overrides: RawState = {}) => parseState({ ...minusA2State(), ...overrides });

describe('mapping', () => {
  it('maps power and purifier state', () => {
    assert.equal(map.active(state({ power: false })), HK.Active.INACTIVE);
    assert.equal(map.currentPurifierState(state({ power: false })), HK.CurrentAirPurifierState.INACTIVE);
    assert.equal(map.currentPurifierState(state()), HK.CurrentAirPurifierState.PURIFYING_AIR);
    assert.equal(map.currentPurifierState(state({ idle: 1 })), HK.CurrentAirPurifierState.IDLE);
    assert.equal(map.currentPurifierState(state({ idle: 0 })), HK.CurrentAirPurifierState.PURIFYING_AIR);
  });

  it('maps modes', () => {
    assert.equal(map.targetPurifierState(state({ mode: Mode.Auto })), HK.TargetAirPurifierState.AUTO);
    assert.equal(map.targetPurifierState(state({ mode: Mode.Manual })), HK.TargetAirPurifierState.MANUAL);
    assert.equal(map.targetPurifierState(state({ mode: Mode.Pollen })), HK.TargetAirPurifierState.MANUAL);
    assert.deepEqual(map.targetPurifierUpdate(HK.TargetAirPurifierState.AUTO), { power: true, mode: Mode.Auto });
    assert.deepEqual(map.targetPurifierUpdate(HK.TargetAirPurifierState.MANUAL), { power: true, mode: Mode.Manual });
  });

  it('maps fan speed to and from percentages', () => {
    const cases: [number, number][] = [
      [Speed.Silent, 20],
      [Speed.Low, 40],
      [Speed.Medium, 60],
      [Speed.High, 80],
      [Speed.Turbo, 100],
      [Speed.SuperSilent, 1],
    ];
    for (const [speed, pct] of cases) {
      assert.equal(map.rotationSpeed(state({ speed })), pct, `speed ${speed}`);
    }
    assert.equal(map.rotationSpeed(state({ power: false })), 0);

    assert.deepEqual(map.rotationSpeedUpdate(0), { power: false });
    assert.deepEqual(map.rotationSpeedUpdate(1), { power: true, speed: Speed.Silent });
    assert.deepEqual(map.rotationSpeedUpdate(20), { power: true, speed: Speed.Silent });
    assert.deepEqual(map.rotationSpeedUpdate(21), { power: true, speed: Speed.Low });
    assert.deepEqual(map.rotationSpeedUpdate(50), { power: true, speed: Speed.Medium });
    assert.deepEqual(map.rotationSpeedUpdate(100), { power: true, speed: Speed.Turbo });
    for (let pct = 1; pct <= 100; pct++) {
      const update = map.rotationSpeedUpdate(pct);
      assert.ok(update.speed !== Speed.SuperSilent && update.speed !== undefined, `${pct}%`);
    }
  });

  it('maps air quality in both directions', () => {
    assert.equal(map.airQuality(state({ quality: 4 }), 'higherIsBetter'), HK.AirQuality.EXCELLENT);
    assert.equal(map.airQuality(state({ quality: 1 }), 'higherIsBetter'), HK.AirQuality.INFERIOR);
    assert.equal(map.airQuality(state({ quality: 4 }), 'higherIsWorse'), HK.AirQuality.POOR);
    assert.equal(map.airQuality(state({ quality: 1 }), 'higherIsWorse'), HK.AirQuality.GOOD);
    assert.equal(map.airQuality(state({ quality: undefined }), 'higherIsBetter'), HK.AirQuality.UNKNOWN);
    assert.equal(map.airQuality(state({ quality: 9 }), 'higherIsBetter'), HK.AirQuality.UNKNOWN);
  });

  it('accounts for the BioGS quality offset', () => {
    assert.equal(parseState({ model: Model.BioGS, quality: 3 }).quality, 2);
  });

  it('maps filter state against the nominal filter life', () => {
    assert.equal(map.filterLifeLevel(state({ filter_life: 109890, filter_timer: 525600 })), 21);
    assert.equal(map.filterLifeLevel(state({ filter_life: 600, filter_timer: 600 })), 100);
    assert.equal(map.filterLifeLevel(state({ filter_life: -5 })), 0);
    assert.equal(map.filterChange(state({ filter_replacement: true })), HK.FilterChangeIndication.CHANGE_FILTER);
    assert.deepEqual(map.filterResetUpdate(state({ filter_timer: 1000 })), { filterLife: 1000, filterReplacement: false });
  });

  it('maps switches', () => {
    assert.equal(map.supportsPollen(state({ model: Model.MinusA2 })), true);
    assert.equal(map.supportsPollen(state({ model: Model.A3 })), false);
    assert.equal(map.pollenOn(state({ mode: Mode.Pollen })), true);
    assert.deepEqual(map.pollenUpdate(true), { power: true, mode: Mode.Pollen });
    assert.deepEqual(map.pollenUpdate(false), { mode: Mode.Auto });

    assert.equal(map.moodLightOn(state({ moodlight: Moodlight.Off })), false);
    assert.equal(map.moodLightOn(state({ moodlight: Moodlight.Auto })), true);
    assert.deepEqual(map.moodLightUpdate(true), { moodlight: Moodlight.On });

    assert.equal(map.displayLightsOn(state({ all_light_off: Lights.Off })), false);
    assert.equal(map.displayLightsOn(state({ all_light_off: Lights.Auto })), true);
    assert.deepEqual(map.displayLightsUpdate(false), { lights: Lights.Off });

    assert.equal(map.statusFault(state({ error: 0 })), HK.StatusFault.NO_FAULT);
    assert.equal(map.statusFault(state({ error: 4 })), HK.StatusFault.GENERAL_FAULT);
  });
});
