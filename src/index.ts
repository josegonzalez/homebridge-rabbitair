import type { API } from 'homebridge';

import { RabbitAirPlatform } from './platform.js';
import { PLATFORM_NAME } from './settings.js';

/** Homebridge entry point. */
export default (api: API): void => {
  api.registerPlatform(PLATFORM_NAME, RabbitAirPlatform);
};

export { RabbitAirPlatform } from './platform.js';
export { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
export type { DeviceConfig, RabbitAirPlatformConfig } from './settings.js';
