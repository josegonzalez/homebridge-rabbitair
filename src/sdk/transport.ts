import { createSocket, type Socket as UdpSocket } from 'node:dgram';
import { connect as tcpConnect, type Socket as TcpSocket } from 'node:net';

/** A message-oriented connection to a device. */
export interface Transport {
  send(message: Buffer): Promise<void>;
  /** Registers the handler for incoming messages. */
  onMessage(handler: (message: Buffer) => void): void;
  /** Registers the handler for fatal errors and closes. */
  onError(handler: (error: Error) => void): void;
  close(): void;
}

export type TransportKind = 'udp' | 'tcp';

/** Opens a transport to host:port. */
export async function openTransport(kind: TransportKind, host: string, port: number): Promise<Transport> {
  return kind === 'tcp' ? openTcp(host, port) : openUdp(host, port);
}

async function openUdp(host: string, port: number): Promise<Transport> {
  const socket: UdpSocket = createSocket('udp4');
  let onError: (error: Error) => void = () => {};
  socket.on('error', (err) => onError(err));

  await new Promise<void>((resolve, reject) => {
    const fail = (err: Error) => {
      socket.close();
      reject(err);
    };
    socket.once('error', fail);
    socket.connect(port, host, () => {
      socket.off('error', fail);
      resolve();
    });
  });

  return {
    send: (message) =>
      new Promise((resolve, reject) => {
        socket.send(message, (err) => (err ? reject(err) : resolve()));
      }),
    onMessage: (handler) => {
      socket.on('message', (msg) => handler(msg));
    },
    onError: (handler) => {
      onError = handler;
    },
    close: () => {
      try {
        socket.close();
      } catch {
        // already closed
      }
    },
  };
}

async function openTcp(host: string, port: number): Promise<Transport> {
  const socket: TcpSocket = tcpConnect({ host, port, noDelay: true });
  let onError: (error: Error) => void = () => {};
  let onMessage: (message: Buffer) => void = () => {};
  let buffer = Buffer.alloc(0);

  await new Promise<void>((resolve, reject) => {
    socket.once('connect', () => {
      socket.off('error', reject);
      resolve();
    });
    socket.once('error', reject);
  });

  socket.on('error', (err) => onError(err));
  socket.on('close', () => onError(new Error('connection closed by device')));
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const size = buffer.readUInt16LE(0);
      if (buffer.length < 2 + size) {
        break;
      }
      const message = buffer.subarray(2, 2 + size);
      buffer = buffer.subarray(2 + size);
      onMessage(Buffer.from(message));
    }
  });

  return {
    send: (message) =>
      new Promise((resolve, reject) => {
        if (message.length > 0xffff) {
          reject(new Error('message too large'));
          return;
        }
        const header = Buffer.alloc(2);
        header.writeUInt16LE(message.length, 0);
        socket.write(Buffer.concat([header, message]), (err) => (err ? reject(err) : resolve()));
      }),
    onMessage: (handler) => {
      onMessage = handler;
    },
    onError: (handler) => {
      onError = handler;
    },
    close: () => {
      socket.removeAllListeners('close');
      socket.destroy();
    },
  };
}
