import type { API, DynamicPlatformPlugin, Logging, PlatformAccessory } from 'homebridge';

import { PurifierAccessory, type AccessoryContext } from './accessory.js';
import { discover, normalizeMac, parseToken, RabbitAirClient, type DiscoveredDevice } from './sdk/index.js';
import {
  DEFAULT_POLL_INTERVAL,
  isBlankDevice,
  MIN_POLL_INTERVAL,
  PLATFORM_NAME,
  PLUGIN_NAME,
  type DeviceConfig,
  type RabbitAirPlatformConfig,
} from './settings.js';

export class RabbitAirPlatform implements DynamicPlatformPlugin {
  private readonly cached = new Map<string, PlatformAccessory<AccessoryContext>>();
  private readonly active: PurifierAccessory[] = [];
  private readonly config: RabbitAirPlatformConfig;

  constructor(
    private readonly log: Logging,
    config: RabbitAirPlatformConfig,
    private readonly api: API,
  ) {
    this.config = config;
    api.on('didFinishLaunching', () => {
      this.launch().catch((err) => this.log.error(`setup failed: ${err instanceof Error ? err.stack : err}`));
    });
    api.on('shutdown', () => {
      for (const a of this.active) {
        a.stop();
      }
    });
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cached.set(accessory.UUID, accessory as PlatformAccessory<AccessoryContext>);
  }

  private async launch(): Promise<void> {
    const devices = this.validDevices();
    const discovery = this.config.discovery !== false;

    let found: DiscoveredDevice[] = [];
    if (discovery && devices.length > 0) {
      try {
        found = await discover({ timeoutMs: 3000 });
        this.log.debug(`discovered ${found.length} device(s): ${found.map((d) => `${d.address} (${d.id})`).join(', ')}`);
      } catch (err) {
        this.log.warn(`discovery failed: ${err instanceof Error ? err.message : err}`);
      }
      this.reportUnconfigured(found, devices);
    }

    const keep = new Set<string>();
    for (const device of devices) {
      const mac = device.mac ? normalizeMac(device.mac) : undefined;
      const uuid = this.api.hap.uuid.generate(`rabbitair:${mac ?? device.host}`);
      const accessory = this.cached.get(uuid);
      const host = (mac && found.find((d) => d.id === mac)?.address) || device.host || accessory?.context.host;
      if (!host) {
        this.log.error(`[${device.name}] not found on the network; set "host" or check the MAC address`);
        if (accessory) {
          keep.add(uuid); // keep it cached so HomeKit settings survive until the device returns
        }
        continue;
      }
      keep.add(uuid);
      this.add(uuid, device, mac, host, accessory);
    }

    const stale = [...this.cached.values()].filter((a) => !keep.has(a.UUID));
    if (stale.length > 0) {
      this.log.info(`removing ${stale.length} accessory(ies) no longer in the configuration`);
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    }
  }

  private add(
    uuid: string,
    device: DeviceConfig,
    mac: string | undefined,
    host: string,
    cached: PlatformAccessory<AccessoryContext> | undefined,
  ): void {
    let accessory = cached;
    const isNew = !accessory;
    if (!accessory) {
      accessory = new this.api.platformAccessory<AccessoryContext>(device.name, uuid);
    }
    accessory.context = { ...accessory.context, device, host, mac: mac ?? accessory.context?.mac };

    const client = new RabbitAirClient({ host, token: device.token, transport: device.transport });
    const purifier = new PurifierAccessory(
      {
        api: this.api,
        log: this.log,
        pollIntervalMs: 1000 * Math.max(MIN_POLL_INTERVAL, this.config.pollInterval ?? DEFAULT_POLL_INTERVAL),
        airQualityScale: this.config.airQualityScale ?? 'higherIsBetter',
        discovery: this.config.discovery !== false,
        save: (a) => this.api.updatePlatformAccessories([a]),
      },
      accessory,
      client,
    );

    if (isNew) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      this.log.info(`[${device.name}] added at ${host}`);
    } else {
      this.api.updatePlatformAccessories([accessory]);
    }
    this.active.push(purifier);
    purifier.start();
  }

  private validDevices(): DeviceConfig[] {
    const out: DeviceConfig[] = [];
    const seen = new Set<string>();
    for (const [i, device] of (this.config.devices ?? []).entries()) {
      if (isBlankDevice(device)) {
        this.log.debug(`ignoring empty purifier entry ${i + 1}`);
        continue;
      }
      const label = device.name || `device ${i + 1}`;
      if (!device.name) {
        this.log.error(`${label}: "name" is required`);
        continue;
      }
      try {
        parseToken(device.token ?? '');
      } catch {
        this.log.error(`[${label}] "token" must be the 32 character user key from the Rabbit Air app`);
        continue;
      }
      if (!device.mac && !device.host) {
        this.log.error(`[${label}] set "mac" (recommended) or "host"`);
        continue;
      }
      const key = device.mac ? normalizeMac(device.mac) : device.host!;
      if (seen.has(key)) {
        this.log.error(`[${label}] is configured more than once`);
        continue;
      }
      seen.add(key);
      out.push(device);
    }
    return out;
  }

  private reportUnconfigured(found: DiscoveredDevice[], devices: DeviceConfig[]): void {
    const macs = new Set(devices.filter((d) => d.mac).map((d) => normalizeMac(d.mac!)));
    const hosts = new Set(devices.map((d) => d.host).filter(Boolean));
    for (const d of found) {
      if (!macs.has(d.id) && !hosts.has(d.address)) {
        this.log.info(`found an unconfigured Rabbit Air device at ${d.address} (MAC ${d.id}, Thing ID ${d.name})`);
      }
    }
  }
}
