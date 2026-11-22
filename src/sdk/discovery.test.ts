import assert from 'node:assert/strict';
import { createSocket } from 'node:dgram';
import { describe, it } from 'node:test';

import { assemble, discover, findDevice, SERVICE_TYPE } from './discovery.js';
import { decodeMessage, encodeQuery, encodeResponse, RecordType, type ResourceRecord } from './mdns.js';

function deviceRecords(name: string, id: string, address: string): ResourceRecord[] {
  const instance = `${name}.${SERVICE_TYPE}`;
  const host = `${name}.local`;
  return [
    { name: SERVICE_TYPE, ttl: 120, type: RecordType.PTR, target: instance },
    { name: instance, ttl: 120, type: RecordType.SRV, priority: 0, weight: 0, port: 9009, target: host },
    { name: instance, ttl: 120, type: RecordType.TXT, entries: [`id=${id}`] },
    { name: host, ttl: 120, type: RecordType.A, address },
  ];
}

describe('mdns', () => {
  it('encodes queries with the unicast bit', () => {
    const msg = decodeMessage(encodeQuery([{ name: SERVICE_TYPE, type: RecordType.PTR, unicast: true }]));
    assert.equal(msg.isResponse, false);
    assert.deepEqual(msg.questions, [{ name: SERVICE_TYPE, type: RecordType.PTR, unicast: true }]);
  });

  it('round trips responses', () => {
    const records = deviceRecords('fd50', '8CAAB5AAE3A4', '192.168.1.188');
    const msg = decodeMessage(encodeResponse(records));
    assert.equal(msg.isResponse, true);
    assert.deepEqual(msg.records, records);
  });

  it('follows compression pointers', () => {
    // An A record for "foo.local" at offset 12, then a PTR record whose name
    // and target are both pointers back to offset 12.
    const header = Buffer.from([0, 0, 0x84, 0, 0, 0, 0, 2, 0, 0, 0, 0]);
    const fooLocal = Buffer.from([3, ...Buffer.from('foo'), 5, ...Buffer.from('local'), 0]);
    const aMeta = Buffer.from([0, 1, 0, 1, 0, 0, 0, 120, 0, 4, 10, 0, 0, 1]);
    const ptr = Buffer.from([0xc0, 12, 0, 12, 0, 1, 0, 0, 0, 120, 0, 2, 0xc0, 12]);
    const msg = decodeMessage(Buffer.concat([header, fooLocal, aMeta, ptr]));
    assert.equal(msg.records.length, 2);
    assert.equal((msg.records[0] as { address: string }).address, '10.0.0.1');
    assert.equal(msg.records[1]!.name, 'foo.local');
    assert.equal((msg.records[1] as { target: string }).target, 'foo.local');
  });

  it('rejects truncated and looping messages', () => {
    assert.throws(() => decodeMessage(Buffer.alloc(5)));
    const loop = Buffer.concat([Buffer.from([0, 0, 0x84, 0, 0, 1, 0, 0, 0, 0, 0, 0]), Buffer.from([0xc0, 12])]);
    assert.throws(() => decodeMessage(loop));
  });
});

describe('assemble', () => {
  it('builds devices from records in any order and ignores incomplete ones', () => {
    const records = [
      ...deviceRecords('bbb', 'AC67B2D2689C', '192.168.1.189').reverse(),
      ...deviceRecords('aaa', '8CAAB5AAE3A4', '192.168.1.188'),
      { name: SERVICE_TYPE, ttl: 120, type: RecordType.PTR, target: `ccc.${SERVICE_TYPE}` } as ResourceRecord,
    ];
    const devices = assemble(records);
    assert.deepEqual(
      devices.map((d) => [d.address, d.id, d.name, d.port]),
      [
        ['192.168.1.188', '8CAAB5AAE3A4', 'aaa', 9009],
        ['192.168.1.189', 'AC67B2D2689C', 'bbb', 9009],
      ],
    );
  });

  it('keeps one entry per MAC when a device re-paired under a new name', () => {
    const records = [...deviceRecords('old', '8CAAB5AAE3A4', '192.168.1.188'), ...deviceRecords('new', '8CAAB5AAE3A4', '192.168.1.188')];
    assert.equal(assemble(records).length, 1);
  });
});

/** A responder that answers queries by unicast; the first query is ignored. */
async function responder(records: ResourceRecord[], ignoreFirst = true) {
  const socket = createSocket('udp4');
  let seen = 0;
  socket.on('message', (msg, from) => {
    const q = decodeMessage(msg);
    if (q.isResponse || (ignoreFirst && seen++ === 0)) {
      return;
    }
    socket.send(encodeResponse(records), from.port, from.address);
  });
  await new Promise<void>((resolve) => socket.bind(0, '127.0.0.1', resolve));
  return { socket, target: { address: '127.0.0.1', port: socket.address().port } };
}

describe('discover', () => {
  it('finds devices across several query rounds', async () => {
    const { socket, target } = await responder(deviceRecords('fd50', '8CAAB5AAE3A4', '127.0.0.1'));
    try {
      const devices = await discover({ timeoutMs: 600, target, listenMulticast: false, interfaceAddress: '127.0.0.1' });
      assert.equal(devices.length, 1);
      assert.equal(devices[0]!.id, '8CAAB5AAE3A4');
    } finally {
      socket.close();
    }
  });

  it('stops early once the wanted device is found', async () => {
    const { socket, target } = await responder(deviceRecords('fd50', '8CAAB5AAE3A4', '127.0.0.1'), false);
    try {
      const start = Date.now();
      const device = await findDevice('8c:aa:b5:aa:e3:a4', { timeoutMs: 3000, target, listenMulticast: false, interfaceAddress: '127.0.0.1' });
      assert.equal(device?.address, '127.0.0.1');
      assert.ok(Date.now() - start < 1000, 'returned before the full window');
    } finally {
      socket.close();
    }
  });
});
