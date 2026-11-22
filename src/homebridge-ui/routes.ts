/** Route handlers for the settings UI server, kept separate so they can be tested. */
import { RequestError } from '@homebridge/plugin-ui-utils';

import {
  discover,
  enumName,
  InvalidTokenError,
  Model,
  normalizeMac,
  parseToken,
  RabbitAirClient,
  TimeoutError,
  type TransportKind,
} from '../sdk/index.js';

export interface VerifyRequest {
  host?: string;
  token?: string;
  transport?: TransportKind;
}

export interface VerifyResult {
  mac: string;
  thingId: string;
  model?: string;
  firmware?: string;
}

export async function discoverDevices() {
  const devices = await discover({ timeoutMs: 4000 });
  return devices.map((d) => ({ thingId: d.name, address: d.address, port: d.port, mac: d.id }));
}

export async function verifyDevice(body: VerifyRequest): Promise<VerifyResult> {
  const host = body.host?.trim();
  const token = body.token?.trim() ?? '';
  if (!host) {
    throw new RequestError('A host is required.', { code: 'host' });
  }
  try {
    parseToken(token);
  } catch (err) {
    if (err instanceof InvalidTokenError) {
      throw new RequestError('The user key must be 32 hexadecimal characters.', { code: 'token-format' });
    }
    throw err;
  }

  const client = new RabbitAirClient({ host, token, transport: body.transport, timeoutMs: 2000, retries: 2 });
  try {
    const info = await client.getInfo();
    const state = await client.getState();
    return {
      mac: normalizeMac(info.mac ?? ''),
      thingId: info.name,
      model: enumName(Model, state.model),
      firmware: state.wifiFirmware ?? info.mcu,
    };
  } catch (err) {
    if (err instanceof TimeoutError) {
      throw new RequestError('The purifier did not accept the key.', { code: 'rejected' });
    }
    throw new RequestError(err instanceof Error ? err.message : String(err), { code: 'error' });
  } finally {
    client.close();
  }
}
