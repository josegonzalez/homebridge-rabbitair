import { createSocket, type Socket } from 'node:dgram';
import { createServer, type Server } from 'node:net';

import { decrypt, encrypt, parseToken } from '../sdk/crypto.js';
import { Command } from '../sdk/client.js';
import type { RawState } from '../sdk/types.js';

export const TEST_TOKEN = '0123456789abcdef0123456789abcdef';

/** A MinusA2 state as reported by real firmware 2.4.4. */
export function minusA2State(): RawState {
  return {
    model: 1,
    firmware: [3],
    power: true,
    mode: 2,
    speed: 1,
    quality: 3,
    sensitivity: 0,
    ionizer: false,
    moodlight: 1,
    sleep: false,
    filter_replacement: false,
    filter_life: 109890,
    light_sensor: true,
    particulate_sensor: 1,
    filter_timer: 525600,
    all_light_off: 1,
    error: 0,
    timer_mode: 0,
    timer: 0,
    schedule: '000000000000000000000000',
    tz: null,
    s2: null,
    rssi: -41,
    v: '2.4.4',
  };
}

export interface FakeDeviceOptions {
  token?: string;
  state?: RawState;
  /** Number of requests to ignore before answering. */
  drop?: number;
  transport?: 'udp' | 'tcp';
}

/** Emulates a Rabbit Air device on localhost. */
export class FakeDevice {
  readonly requests: Record<string, unknown>[] = [];
  state: RawState;
  drop: number;
  /** When set, the device replies with this error to state writes. */
  rejectWrites?: unknown;
  port = 0;

  private readonly key: Buffer;
  private udp?: Socket;
  private tcp?: Server;

  constructor(private readonly options: FakeDeviceOptions = {}) {
    this.key = parseToken(options.token ?? TEST_TOKEN);
    this.state = options.state ?? minusA2State();
    this.drop = options.drop ?? 0;
  }

  async start(): Promise<this> {
    if (this.options.transport === 'tcp') {
      this.tcp = createServer((conn) => {
        let buf = Buffer.alloc(0);
        // No encoding is set on the socket, so chunks are always Buffers.
        conn.on('data', (chunk: Buffer) => {
          buf = Buffer.concat([buf, chunk]);
          while (buf.length >= 2 && buf.length >= 2 + buf.readUInt16LE(0)) {
            const msg = buf.subarray(2, 2 + buf.readUInt16LE(0));
            buf = buf.subarray(2 + msg.length);
            const reply = this.handle(Buffer.from(msg));
            if (reply === 'close') {
              conn.destroy();
              return;
            }
            if (reply) {
              const head = Buffer.alloc(2);
              head.writeUInt16LE(reply.length, 0);
              conn.write(Buffer.concat([head, reply]));
            }
          }
        });
        conn.on('error', () => {});
      });
      await new Promise<void>((resolve) => this.tcp!.listen(0, '127.0.0.1', resolve));
      this.port = (this.tcp.address() as { port: number }).port;
    } else {
      this.udp = createSocket('udp4');
      this.udp.on('message', (msg, from) => {
        // An unrelated packet first, which the client must ignore.
        this.udp!.send(encrypt(this.key, Buffer.from('{"id":"noise"}')), from.port, from.address);
        const reply = this.handle(msg);
        if (reply && reply !== 'close') {
          this.udp!.send(reply, from.port, from.address);
        }
      });
      await new Promise<void>((resolve) => this.udp!.bind(0, '127.0.0.1', resolve));
      this.port = this.udp.address().port;
    }
    return this;
  }

  stop(): void {
    this.udp?.close();
    this.tcp?.close();
  }

  private handle(msg: Buffer): Buffer | 'close' | undefined {
    let req: Record<string, unknown>;
    try {
      req = JSON.parse(decrypt(this.key, msg).toString());
    } catch {
      return this.options.transport === 'tcp' ? 'close' : undefined;
    }
    this.requests.push(req);
    if (this.drop > 0) {
      this.drop--;
      return undefined;
    }

    const resp: Record<string, unknown> = { id: req.id };
    switch (req.cmd) {
      case Command.Timestamp:
        resp.data = { ts: 1000 };
        break;
      case Command.Info:
        resp.data = { name: 'thing', mac: 'AC:67:B2:D2:68:9C', mcu: '2.4.4', uptime: 60 };
        break;
      case Command.State:
        if (req.data) {
          if (this.rejectWrites !== undefined) {
            resp.error = this.rejectWrites;
            break;
          }
          Object.assign(this.state, req.data);
        }
        resp.data = this.state;
        break;
      default:
        resp.error = 1;
    }
    return encrypt(this.key, Buffer.from(JSON.stringify(resp)));
  }
}
