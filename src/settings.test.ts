import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { isBlankDevice } from './settings.js';

describe('isBlankDevice', () => {
  it('treats rows that only hold form defaults as blank', () => {
    assert.equal(isBlankDevice(undefined), true);
    assert.equal(isBlankDevice({}), true);
    // What the Homebridge settings form saves for its pre-created empty row.
    assert.equal(
      isBlankDevice({ transport: 'udp', airQualitySensor: true, filterMaintenance: true, ionizerSwitch: true, name: ' ' }),
      true,
    );
  });

  it('keeps entries with any identifying field', () => {
    assert.equal(isBlankDevice({ name: 'Living Room' }), false);
    assert.equal(isBlankDevice({ token: '0123456789ABCDEF0123456789ABCDEF' }), false);
    assert.equal(isBlankDevice({ mac: '8C:AA:B5:AA:E3:A4' }), false);
    assert.equal(isBlankDevice({ host: '192.168.1.188' }), false);
  });
});
