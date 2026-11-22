import { randomInt } from 'node:crypto';
import { performance } from 'node:perf_hooks';

import { decrypt, encrypt, parseToken } from './crypto.js';
import { openTransport, type Transport, type TransportKind } from './transport.js';
import { encodeUpdate, parseState, type Info, type RawState, type State, type Update } from './types.js';

/** The UDP and TCP port Rabbit Air devices listen on. */
export const DEFAULT_PORT = 9009;

/** Command numbers. */
export const Command = { State: 4, Timestamp: 9, Info: 255 } as const;

/** Thrown when the device does not answer in time. */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** Thrown when the device answers with an error. */
export class ProtocolError extends Error {
  constructor(readonly detail: unknown) {
    super(`device returned error: ${JSON.stringify(detail)}`);
    this.name = 'ProtocolError';
  }
}

export interface ClientOptions {
  /** IP address or hostname. A bare device ID gets ".local" appended. */
  host: string;
  /** 32 character hex access token (the app's "User key"). */
  token: string;
  port?: number;
  /** "udp" (default) or "tcp". */
  transport?: TransportKind;
  /** Timeout per attempt in milliseconds (default 2000). */
  timeoutMs?: number;
  /** Attempts per request (default 3). Ignored for TCP, which does not lose messages. */
  retries?: number;
}

interface Pending {
  resolve: (data: unknown) => void;
  reject: (error: Error) => void;
}

/**
 * A client for a single Rabbit Air device. Requests are sent one at a time
 * over a connection that is opened on first use and kept open.
 */
export class RabbitAirClient {
  readonly port: number;
  readonly transportKind: TransportKind;
  timeoutMs: number;
  retries: number;

  private hostValue: string;
  private readonly key: Buffer;
  private nextId = randomInt(0x1000000);
  private transport?: Transport;
  private opening?: Promise<Transport>;
  private pending = new Map<number, Pending>();
  private queue: Promise<unknown> = Promise.resolve();
  private clock?: { base: number; at: number };
  private closed = false;

  constructor(options: ClientOptions) {
    this.key = parseToken(options.token);
    const [host, port] = splitHostPort(options.host);
    this.hostValue = normalizeHost(host);
    this.port = options.port ?? port ?? DEFAULT_PORT;
    this.transportKind = options.transport ?? 'udp';
    this.timeoutMs = options.timeoutMs ?? 2000;
    this.retries = Math.max(1, options.retries ?? 3);
  }

  /** The host the client connects to. */
  get host(): string {
    return this.hostValue;
  }

  /** Points the client at a new address, for example after the device's IP changed. */
  setHost(host: string): void {
    const next = normalizeHost(host);
    if (next !== this.hostValue) {
      this.hostValue = next;
      this.reset();
    }
  }

  /** Returns the current device state. */
  async getState(): Promise<State> {
    const data = (await this.command(Command.State)) as RawState;
    return parseState(data ?? {});
  }

  /** Returns device information such as MAC address and firmware. */
  async getInfo(): Promise<Info> {
    return (await this.command(Command.Info)) as Info;
  }

  /** Changes device settings. */
  async setState(update: Update): Promise<void> {
    await this.command(Command.State, encodeUpdate(update));
  }

  /** Sends a raw command and returns the response's data field. */
  command(cmd: number, data?: Record<string, unknown>): Promise<unknown> {
    if (this.closed) {
      return Promise.reject(new Error('client is closed'));
    }
    const run = this.queue.then(() => this.exec(cmd, data));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Closes the connection. The client cannot be used afterwards. */
  close(): void {
    this.closed = true;
    this.reset(new Error('client is closed'));
  }

  private async exec(cmd: number, data?: Record<string, unknown>): Promise<unknown> {
    try {
      const transport = await this.connection();
      if (!this.clock) {
        const reply = (await this.exchange(transport, { id: this.id(), cmd: Command.Timestamp })) as { ts?: number };
        if (typeof reply?.ts !== 'number') {
          throw new Error('device did not return a timestamp');
        }
        this.clock = { base: reply.ts, at: performance.now() };
      }
      const ts = this.clock.base + Math.round((performance.now() - this.clock.at) / 1000);
      const request: Record<string, unknown> = { id: this.id(), cmd, ts };
      if (data !== undefined) {
        request.data = data;
      }
      return await this.exchange(transport, request);
    } catch (err) {
      if (!(err instanceof ProtocolError)) {
        this.reset();
      }
      throw err;
    }
  }

  private id(): number {
    const id = this.nextId;
    this.nextId = (this.nextId + 1) % 0x100000000;
    return id;
  }

  private connection(): Promise<Transport> {
    if (this.transport) {
      return Promise.resolve(this.transport);
    }
    if (!this.opening) {
      this.opening = openTransport(this.transportKind, this.hostValue, this.port)
        .then((transport) => {
          transport.onMessage((msg) => this.receive(msg));
          transport.onError((err) => this.reset(err));
          this.transport = transport;
          return transport;
        })
        .finally(() => {
          this.opening = undefined;
        });
    }
    return this.opening;
  }

  private async exchange(transport: Transport, request: Record<string, unknown>): Promise<unknown> {
    const id = request.id as number;
    const payload = encrypt(this.key, Buffer.from(JSON.stringify(request)));
    const attempts = this.transportKind === 'tcp' ? 1 : this.retries;

    for (let attempt = 1; ; attempt++) {
      const reply = new Promise<unknown>((resolve, reject) => {
        this.pending.set(id, { resolve, reject });
      });
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new TimeoutError(`no response from ${this.hostValue}:${this.port}`)),
          this.timeoutMs,
        );
      });
      try {
        await transport.send(payload);
        return await Promise.race([reply, timeout]);
      } catch (err) {
        if (!(err instanceof TimeoutError) || attempt >= attempts) {
          if (err instanceof TimeoutError && attempts > 1) {
            err.message += ` after ${attempts} attempts`;
          }
          throw err;
        }
      } finally {
        clearTimeout(timer);
        this.pending.delete(id);
      }
    }
  }

  private receive(message: Buffer): void {
    let response: { id?: unknown; data?: unknown; error?: unknown };
    try {
      response = JSON.parse(decrypt(this.key, message).toString('utf8'));
    } catch {
      return; // not for us, or encrypted with a different key
    }
    if (typeof response?.id !== 'number') {
      return;
    }
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    if (isTruthy(response.error)) {
      pending.reject(new ProtocolError(response.error));
    } else {
      pending.resolve(response.data);
    }
  }

  private reset(error?: Error): void {
    this.transport?.close();
    this.transport = undefined;
    this.clock = undefined;
    if (error) {
      for (const p of this.pending.values()) {
        p.reject(error);
      }
      this.pending.clear();
    }
  }
}

function isTruthy(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (value !== null && typeof value === 'object') {
    return Object.keys(value).length > 0;
  }
  return Boolean(value);
}

/** Splits "host:port" (or "[v6]:port"); a bare IPv6 address has no port. */
export function splitHostPort(value: string): [string, number | undefined] {
  const v = value.trim();
  const bracketed = /^\[([^\]]+)\](?::(\d+))?$/.exec(v);
  if (bracketed) {
    return [bracketed[1]!, bracketed[2] ? Number(bracketed[2]) : undefined];
  }
  const withPort = /^([^:]+):(\d+)$/.exec(v);
  if (withPort) {
    return [withPort[1]!, Number(withPort[2])];
  }
  return [v, undefined];
}

/** Appends ".local" to a bare device ID. */
export function normalizeHost(host: string): string {
  const h = host.trim();
  if (h.includes('.') || h.includes(':') || h === 'localhost') {
    return h;
  }
  return `${h}.local`;
}
