import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { UpdateCoalescer } from './coalescer.js';
import type { Update } from './sdk/index.js';

describe('UpdateCoalescer', () => {
  it('merges updates that arrive together into one command', async () => {
    const sent: Update[] = [];
    const c = new UpdateCoalescer(async (u) => void sent.push(u), 20);
    await Promise.all([c.queue({ power: true }), c.queue({ speed: 2 }), c.queue({ speed: 4 })]);
    assert.deepEqual(sent, [{ power: true, speed: 4 }]);
  });

  it('sends later updates as a separate command after the first finishes', async () => {
    const sent: Update[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const c = new UpdateCoalescer(async (u) => {
      sent.push(u);
      if (sent.length === 1) {
        await gate;
      }
    }, 10);
    const first = c.queue({ power: true });
    await new Promise((r) => setTimeout(r, 30));
    const second = c.queue({ speed: 3 });
    await new Promise((r) => setTimeout(r, 30));
    assert.equal(sent.length, 1, 'second command waits for the first');
    release();
    await Promise.all([first, second]);
    assert.deepEqual(sent, [{ power: true }, { speed: 3 }]);
  });

  it('rejects every waiter when the command fails', async () => {
    const c = new UpdateCoalescer(async () => {
      throw new Error('boom');
    }, 5);
    const results = await Promise.allSettled([c.queue({ power: true }), c.queue({ ionizer: true })]);
    assert.ok(results.every((r) => r.status === 'rejected'));
  });
});
