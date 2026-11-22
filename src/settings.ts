import type { PlatformConfig } from 'homebridge';

import type { AirQualityScale } from './mapping.js';
import type { TransportKind } from './sdk/index.js';

export const PLUGIN_NAME = '@josediazgonzalez/homebridge-rabbitair';
export const PLATFORM_NAME = 'RabbitAirLocal';

export interface DeviceConfig {
  name: string;
  /** The app's "User key". */
  token: string;
  /** MAC address; used to find the device and as its stable identity. */
  mac?: string;
  /** IP address or hostname. Optional when the MAC address is given. */
  host?: string;
  transport?: TransportKind;
  /** Optional services. All default to true when the device supports them. */
  airQualitySensor?: boolean;
  filterMaintenance?: boolean;
  ionizerSwitch?: boolean;
  pollenModeSwitch?: boolean;
  moodLightSwitch?: boolean;
  displayLightsSwitch?: boolean;
  childLock?: boolean;
}

export interface RabbitAirPlatformConfig extends PlatformConfig {
  devices?: DeviceConfig[];
  /** Seconds between state polls (default 15, minimum 5). */
  pollInterval?: number;
  /** Use mDNS to find devices and follow address changes (default true). */
  discovery?: boolean;
  airQualityScale?: AirQualityScale;
}

export const DEFAULT_POLL_INTERVAL = 15;
export const MIN_POLL_INTERVAL = 5;
