/**
 * Rabbit Air local network SDK. Import from "@josediazgonzalez/homebridge-rabbitair/sdk"
 * to use it without Homebridge.
 *
 * The protocol follows the Apache-2.0 licensed python-rabbitair library
 * (https://github.com/rabbit-air/python-rabbitair).
 */
export { Command, DEFAULT_PORT, normalizeHost, ProtocolError, RabbitAirClient, splitHostPort, TimeoutError } from './client.js';
export type { ClientOptions } from './client.js';
export { decrypt, encrypt, InvalidTokenError, parseToken } from './crypto.js';
export { assemble, discover, findDevice, SERVICE_TYPE } from './discovery.js';
export type { DiscoveredDevice, DiscoverOptions } from './discovery.js';
export type { TransportKind } from './transport.js';
export {
  applyUpdate,
  DeviceError,
  encodeUpdate,
  enumName,
  FilterType,
  Gas,
  Lights,
  Mode,
  Model,
  Moodlight,
  normalizeMac,
  parseState,
  Quality,
  Sensitivity,
  SETTABLE_SPEEDS,
  Speed,
  TimerMode,
} from './types.js';
export type { Info, RawState, RssiStats, State, Update } from './types.js';
