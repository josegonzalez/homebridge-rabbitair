/**
 * Minimal DNS message encoding and decoding for mDNS service discovery
 * (RFC 1035 and RFC 6762). Only the record types needed for DNS-SD are
 * decoded: A, PTR, TXT and SRV.
 */

export const RecordType = { A: 1, PTR: 12, TXT: 16, AAAA: 28, SRV: 33, ANY: 255 } as const;

export interface Question {
  name: string;
  type: number;
  /** Ask for a unicast response (the "QU" bit). */
  unicast?: boolean;
}

interface BaseRecord {
  name: string;
  ttl: number;
}

export type ResourceRecord =
  | (BaseRecord & { type: typeof RecordType.A; address: string })
  | (BaseRecord & { type: typeof RecordType.PTR; target: string })
  | (BaseRecord & { type: typeof RecordType.TXT; entries: string[] })
  | (BaseRecord & { type: typeof RecordType.SRV; priority: number; weight: number; port: number; target: string })
  | (BaseRecord & { type: number; data: Buffer });

export interface Message {
  id: number;
  isResponse: boolean;
  questions: Question[];
  records: ResourceRecord[];
}

function encodeName(name: string): Buffer {
  const parts: Buffer[] = [];
  for (const label of name.replace(/\.$/, '').split('.')) {
    const bytes = Buffer.from(label, 'utf8');
    if (bytes.length > 63) {
      throw new Error(`DNS label too long: ${label}`);
    }
    parts.push(Buffer.from([bytes.length]), bytes);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

/** Encodes a query message. */
export function encodeQuery(questions: Question[], id = 0): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(id, 0);
  header.writeUInt16BE(questions.length, 4);
  const body = questions.map((q) => {
    const tail = Buffer.alloc(4);
    tail.writeUInt16BE(q.type, 0);
    tail.writeUInt16BE(1 | (q.unicast ? 0x8000 : 0), 2);
    return Buffer.concat([encodeName(q.name), tail]);
  });
  return Buffer.concat([header, ...body]);
}

function decodeName(buf: Buffer, offset: number): { name: string; end: number } {
  const labels: string[] = [];
  let pos = offset;
  let end = -1;
  for (let jumps = 0; jumps < 64; jumps++) {
    if (pos >= buf.length) {
      throw new Error('name runs past end of message');
    }
    const len = buf[pos]!;
    if (len === 0) {
      return { name: labels.join('.'), end: end === -1 ? pos + 1 : end };
    }
    if ((len & 0xc0) === 0xc0) {
      if (pos + 1 >= buf.length) {
        throw new Error('truncated compression pointer');
      }
      if (end === -1) {
        end = pos + 2;
      }
      pos = ((len & 0x3f) << 8) | buf[pos + 1]!;
      continue;
    }
    if (pos + 1 + len > buf.length) {
      throw new Error('label runs past end of message');
    }
    labels.push(buf.toString('utf8', pos + 1, pos + 1 + len));
    pos += 1 + len;
  }
  throw new Error('too many compression pointers');
}

/** Decodes a DNS message. Throws on malformed input. */
export function decodeMessage(buf: Buffer): Message {
  if (buf.length < 12) {
    throw new Error('message too short');
  }
  const id = buf.readUInt16BE(0);
  const flags = buf.readUInt16BE(2);
  const qd = buf.readUInt16BE(4);
  const rrCount = buf.readUInt16BE(6) + buf.readUInt16BE(8) + buf.readUInt16BE(10);
  let pos = 12;

  const questions: Question[] = [];
  for (let i = 0; i < qd; i++) {
    const { name, end } = decodeName(buf, pos);
    if (end + 4 > buf.length) {
      throw new Error('truncated question');
    }
    questions.push({ name, type: buf.readUInt16BE(end), unicast: (buf.readUInt16BE(end + 2) & 0x8000) !== 0 });
    pos = end + 4;
  }

  const records: ResourceRecord[] = [];
  for (let i = 0; i < rrCount; i++) {
    const { name, end } = decodeName(buf, pos);
    if (end + 10 > buf.length) {
      throw new Error('truncated record');
    }
    const type = buf.readUInt16BE(end);
    const ttl = buf.readUInt32BE(end + 4);
    const len = buf.readUInt16BE(end + 8);
    const start = end + 10;
    if (start + len > buf.length) {
      throw new Error('record data runs past end of message');
    }
    const data = buf.subarray(start, start + len);
    pos = start + len;

    switch (type) {
      case RecordType.A:
        if (len === 4) {
          records.push({ name, ttl, type, address: Array.from(data).join('.') });
        }
        break;
      case RecordType.PTR:
        records.push({ name, ttl, type, target: decodeName(buf, start).name });
        break;
      case RecordType.TXT: {
        const entries: string[] = [];
        for (let p = 0; p < data.length; ) {
          const l = data[p]!;
          entries.push(data.toString('utf8', p + 1, p + 1 + l));
          p += 1 + l;
        }
        records.push({ name, ttl, type, entries });
        break;
      }
      case RecordType.SRV:
        if (len >= 7) {
          records.push({
            name,
            ttl,
            type,
            priority: data.readUInt16BE(0),
            weight: data.readUInt16BE(2),
            port: data.readUInt16BE(4),
            target: decodeName(buf, start + 6).name,
          });
        }
        break;
      default:
        records.push({ name, ttl, type, data: Buffer.from(data) });
    }
  }

  return { id, isResponse: (flags & 0x8000) !== 0, questions, records };
}

/** Encodes a response message, used by tests to emulate devices. */
export function encodeResponse(records: ResourceRecord[]): Buffer {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x8400, 2);
  header.writeUInt16BE(records.length, 6);
  const body = records.map((r) => {
    let data: Buffer;
    if ('address' in r) {
      data = Buffer.from(r.address.split('.').map(Number));
    } else if ('entries' in r) {
      data = Buffer.concat(r.entries.map((e) => Buffer.concat([Buffer.from([Buffer.byteLength(e)]), Buffer.from(e)])));
    } else if ('port' in r) {
      const head = Buffer.alloc(6);
      head.writeUInt16BE(r.priority, 0);
      head.writeUInt16BE(r.weight, 2);
      head.writeUInt16BE(r.port, 4);
      data = Buffer.concat([head, encodeName(r.target)]);
    } else if ('target' in r) {
      data = encodeName(r.target);
    } else {
      data = r.data;
    }
    const meta = Buffer.alloc(10);
    meta.writeUInt16BE(r.type, 0);
    meta.writeUInt16BE(1, 2);
    meta.writeUInt32BE(r.ttl, 4);
    meta.writeUInt16BE(data.length, 8);
    return Buffer.concat([encodeName(r.name), meta, data]);
  });
  return Buffer.concat([header, ...body]);
}
