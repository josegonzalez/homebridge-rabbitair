import { createSocket, type Socket } from 'node:dgram';

import { decodeMessage, encodeQuery, RecordType, type Question, type ResourceRecord } from './mdns.js';
import { normalizeMac } from './types.js';

/** The DNS-SD service type Rabbit Air devices advertise. */
export const SERVICE_TYPE = '_rabbitair._udp.local';

const MDNS_GROUP = '224.0.0.251';
const MDNS_PORT = 5353;

/** A device found on the network. */
export interface DiscoveredDevice {
  /** Device ID (the mDNS instance name, shown as "Thing ID" in the app). */
  name: string;
  /** mDNS hostname. */
  host: string;
  /** IPv4 address. */
  address: string;
  port: number;
  /** The "id" TXT record, the device's MAC address without separators. */
  id: string;
  txt: Record<string, string>;
}

export interface DiscoverOptions {
  /** How long to listen, in milliseconds (default 3000). */
  timeoutMs?: number;
  /** Number of queries spread across the window (default 3). */
  rounds?: number;
  /** Local interface address to send queries from. */
  interfaceAddress?: string;
  /** Stop early once a device with this MAC address is found. */
  mac?: string;
  /** Overrides the multicast destination, for tests. */
  target?: { address: string; port: number };
  /** Also listen for multicast responses on port 5353 (default true). */
  listenMulticast?: boolean;
}

/**
 * Finds Rabbit Air devices with mDNS. Several queries are sent because a
 * single query can miss replies. Responses arriving by unicast and by
 * multicast are both used.
 */
export async function discover(options: DiscoverOptions = {}): Promise<DiscoveredDevice[]> {
  const timeoutMs = options.timeoutMs ?? 3000;
  const rounds = Math.max(1, options.rounds ?? 3);
  const target = options.target ?? { address: MDNS_GROUP, port: MDNS_PORT };
  const wantMac = options.mac ? normalizeMac(options.mac) : undefined;
  const records: ResourceRecord[] = [];
  const sockets: Socket[] = [];
  let wake: (() => void) | undefined;

  const onPacket = (msg: Buffer) => {
    try {
      const message = decodeMessage(msg);
      if (message.isResponse) {
        records.push(...message.records);
        if (wantMac && assemble(records).some((d) => d.id === wantMac)) {
          wake?.();
        }
      }
    } catch {
      // ignore malformed packets
    }
  };

  const query = await bindSocket(0, options.interfaceAddress);
  sockets.push(query);
  query.on('message', onPacket);
  if (options.interfaceAddress && target.address === MDNS_GROUP) {
    query.setMulticastInterface(options.interfaceAddress);
  }

  if ((options.listenMulticast ?? true) && target.address === MDNS_GROUP) {
    try {
      const listener = await bindSocket(MDNS_PORT);
      listener.addMembership(MDNS_GROUP, options.interfaceAddress);
      listener.on('message', onPacket);
      sockets.push(listener);
    } catch {
      // port 5353 unavailable; rely on unicast responses
    }
  }

  try {
    const perRound = Math.max(200, Math.floor(timeoutMs / rounds));
    for (let i = 0; i < rounds; i++) {
      const questions: Question[] = [{ name: SERVICE_TYPE, type: RecordType.PTR, unicast: i % 2 === 1 }];
      for (const host of unresolvedHosts(records)) {
        questions.push({ name: host, type: RecordType.A, unicast: true });
      }
      const packet = encodeQuery(questions);
      await new Promise<void>((resolve) => query.send(packet, target.port, target.address, () => resolve()));

      const done = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), perRound);
        wake = () => {
          clearTimeout(timer);
          resolve(true);
        };
      });
      wake = undefined;
      if (done) {
        break;
      }
    }
  } finally {
    for (const s of sockets) {
      try {
        s.close();
      } catch {
        // already closed
      }
    }
  }

  return assemble(records);
}

/** Finds the current address of the device with the given MAC address. */
export async function findDevice(mac: string, options: DiscoverOptions = {}): Promise<DiscoveredDevice | undefined> {
  const id = normalizeMac(mac);
  const devices = await discover({ ...options, mac: id });
  return devices.find((d) => d.id === id);
}

function bindSocket(port: number, address?: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createSocket({ type: 'udp4', reuseAddr: true });
    socket.once('error', (err) => {
      socket.close();
      reject(err);
    });
    socket.bind(port, port === MDNS_PORT ? undefined : address, () => {
      socket.removeAllListeners('error');
      socket.on('error', () => {});
      resolve(socket);
    });
  });
}

const lower = (s: string) => s.toLowerCase().replace(/\.$/, '');

function unresolvedHosts(records: ResourceRecord[]): string[] {
  const addressed = new Set(records.filter((r) => r.type === RecordType.A).map((r) => lower(r.name)));
  const hosts = new Set<string>();
  for (const r of records) {
    if (r.type === RecordType.SRV && 'target' in r && !addressed.has(lower(r.target))) {
      hosts.add(r.target);
    }
  }
  return [...hosts];
}

/** Builds devices from the records collected so far. */
export function assemble(records: ResourceRecord[]): DiscoveredDevice[] {
  const service = lower(SERVICE_TYPE);
  const instances = new Set<string>();
  const srv = new Map<string, { port: number; target: string }>();
  const txt = new Map<string, string[]>();
  const addresses = new Map<string, string>();

  for (const r of records) {
    const name = lower(r.name);
    if (r.type === RecordType.PTR && 'target' in r && name === service) {
      instances.add(lower(r.target));
    } else if (r.type === RecordType.SRV && 'port' in r && name.endsWith(`.${service}`)) {
      srv.set(name, { port: r.port, target: lower(r.target) });
      instances.add(name);
    } else if (r.type === RecordType.TXT && 'entries' in r) {
      txt.set(name, r.entries);
    } else if (r.type === RecordType.A && 'address' in r) {
      addresses.set(name, r.address);
    }
  }

  const byId = new Map<string, DiscoveredDevice>();
  for (const instance of instances) {
    const s = srv.get(instance);
    const address = s ? addresses.get(s.target) : undefined;
    if (!s || !address) {
      continue;
    }
    const fields: Record<string, string> = {};
    for (const entry of txt.get(instance) ?? []) {
      const eq = entry.indexOf('=');
      fields[eq === -1 ? entry : entry.slice(0, eq)] = eq === -1 ? '' : entry.slice(eq + 1);
    }
    const device: DiscoveredDevice = {
      name: instance.slice(0, -(service.length + 1)),
      host: s.target,
      address,
      port: s.port,
      id: normalizeMac(fields.id ?? ''),
      txt: fields,
    };
    byId.set(device.id || device.name, device);
  }
  return [...byId.values()].sort((a, b) => a.address.localeCompare(b.address, undefined, { numeric: true }));
}
