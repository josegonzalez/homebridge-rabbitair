import type { API, Characteristic, CharacteristicValue, Logging, PlatformAccessory, Service, WithUUID } from 'homebridge';

import { UpdateCoalescer } from './coalescer.js';
import * as map from './mapping.js';
import type { AirQualityScale } from './mapping.js';
import {
  applyUpdate,
  enumName,
  findDevice,
  Model,
  normalizeMac,
  type Info,
  type RabbitAirClient,
  type State,
  type Update,
} from './sdk/index.js';
import type { DeviceConfig } from './settings.js';

/** What the accessory needs from the platform. */
export interface AccessoryDeps {
  api: API;
  log: Logging;
  pollIntervalMs: number;
  airQualityScale: AirQualityScale;
  discovery: boolean;
  /** Persists accessory context changes. */
  save: (accessory: PlatformAccessory) => void;
}

export interface AccessoryContext {
  device: DeviceConfig;
  mac?: string;
  host?: string;
  model?: string;
  firmware?: string;
}

type ServiceType = WithUUID<new (displayName?: string, subtype?: string) => Service>;
type CharacteristicType = WithUUID<new () => Characteristic>;
type Getter = (state: State) => CharacteristicValue;

interface Binding {
  key: string;
  service: Service;
  characteristic: CharacteristicType;
  get: Getter;
}

/** Delay before re-reading state after a write; the device applies changes on a one-second cycle. */
const REFRESH_AFTER_WRITE_MS = 2000;
/** Consecutive failed polls before the device is reported as not responding. */
const OFFLINE_AFTER = 2;

/** One Rabbit Air purifier exposed to HomeKit. */
export class PurifierAccessory {
  private state?: State;
  private failures = 0;
  private pollTimer?: NodeJS.Timeout;
  private refreshTimer?: NodeJS.Timeout;
  private stopped = false;
  private polling = false;
  private relocating = false;
  private readonly coalescer: UpdateCoalescer;
  private readonly bindings = new Map<string, Binding>();
  private readonly pushed = new Map<string, CharacteristicValue>();
  private readonly purifier: Service;
  private readonly hap: API['hap'];

  constructor(
    private readonly deps: AccessoryDeps,
    readonly accessory: PlatformAccessory<AccessoryContext>,
    private readonly client: RabbitAirClient,
  ) {
    this.hap = deps.api.hap;
    this.coalescer = new UpdateCoalescer((update) => this.send(update));

    const { Service: S, Characteristic: C } = this.hap;
    this.updateInformation();

    this.purifier = this.ensureService(S.AirPurifier, accessory.displayName);
    this.purifier.setPrimaryService(true);
    this.bind(this.purifier, C.Active, map.active, (v) => ({ power: v === map.HK.Active.ACTIVE }));
    this.bind(this.purifier, C.CurrentAirPurifierState, map.currentPurifierState);
    this.bind(this.purifier, C.TargetAirPurifierState, map.targetPurifierState, (v) => map.targetPurifierUpdate(Number(v)));
    this.bind(this.purifier, C.RotationSpeed, map.rotationSpeed, (v) => map.rotationSpeedUpdate(Number(v)));
    this.purifier.getCharacteristic(C.RotationSpeed).setProps({ minValue: 0, maxValue: 100, minStep: 1 });
  }

  private get device(): DeviceConfig {
    return this.accessory.context.device;
  }

  /** Starts polling. */
  start(): void {
    void this.poll();
  }

  /** Stops polling and closes the connection. */
  stop(): void {
    this.stopped = true;
    clearTimeout(this.pollTimer);
    clearTimeout(this.refreshTimer);
    this.coalescer.cancel();
    this.client.close();
  }

  private prefix(message: string): string {
    return `[${this.accessory.displayName}] ${message}`;
  }

  private async poll(): Promise<void> {
    if (this.stopped || this.polling) {
      return;
    }
    this.polling = true;
    clearTimeout(this.pollTimer);
    try {
      const state = await this.client.getState();
      if (this.failures >= OFFLINE_AFTER) {
        this.deps.log.info(this.prefix('responding again'));
      }
      this.failures = 0;
      const first = !this.state;
      this.state = state;
      if (first) {
        await this.loadInfo();
      }
      this.syncOptionalServices(state);
      this.push();
    } catch (err) {
      this.failures++;
      const message = err instanceof Error ? err.message : String(err);
      if (this.failures === OFFLINE_AFTER) {
        this.deps.log.warn(this.prefix(`not responding: ${message}`));
      } else {
        this.deps.log.debug(this.prefix(`poll failed: ${message}`));
      }
      if (this.failures >= OFFLINE_AFTER) {
        void this.relocate();
      }
    } finally {
      this.polling = false;
      if (!this.stopped) {
        this.pollTimer = setTimeout(() => void this.poll(), this.deps.pollIntervalMs);
      }
    }
  }

  private async loadInfo(): Promise<void> {
    let info: Info | undefined;
    try {
      info = await this.client.getInfo();
    } catch (err) {
      this.deps.log.debug(this.prefix(`could not read device info: ${err instanceof Error ? err.message : err}`));
    }
    const ctx = this.accessory.context;
    const mac = info?.mac ? normalizeMac(info.mac) : ctx.mac;
    const model = enumName(Model, this.state?.model);
    const firmware = this.state?.wifiFirmware ?? info?.mcu;
    if (mac !== ctx.mac || model !== ctx.model || firmware !== ctx.firmware) {
      Object.assign(ctx, { mac, model, firmware });
      this.deps.save(this.accessory);
    }
    this.updateInformation();
  }

  /** Finds the device's new address after it stops responding. */
  private async relocate(): Promise<void> {
    const mac = this.accessory.context.mac;
    if (!this.deps.discovery || !mac || this.relocating) {
      return;
    }
    this.relocating = true;
    try {
      const found = await findDevice(mac, { timeoutMs: 3000 });
      if (found && found.address !== this.client.host) {
        this.deps.log.info(this.prefix(`address changed from ${this.client.host} to ${found.address}`));
        this.client.setHost(found.address);
        this.accessory.context.host = found.address;
        this.deps.save(this.accessory);
        void this.poll();
      }
    } catch (err) {
      this.deps.log.debug(this.prefix(`discovery failed: ${err instanceof Error ? err.message : err}`));
    } finally {
      this.relocating = false;
    }
  }

  private updateInformation(): void {
    const { Service: S, Characteristic: C } = this.hap;
    const ctx = this.accessory.context;
    const info = this.accessory.getService(S.AccessoryInformation) ?? this.accessory.addService(S.AccessoryInformation);
    info.setCharacteristic(C.Manufacturer, 'Rabbit Air');
    info.setCharacteristic(C.Model, ctx.model ?? 'Air Purifier');
    info.setCharacteristic(C.SerialNumber, ctx.mac ?? ctx.device.mac ?? ctx.host ?? 'unknown');
    if (ctx.firmware && /^\d+(\.\d+){0,2}$/.test(ctx.firmware)) {
      info.setCharacteristic(C.FirmwareRevision, ctx.firmware);
    }
  }

  /** Adds or removes optional services to match what the device reports and the configuration allows. */
  private syncOptionalServices(state: State): void {
    const { Service: S, Characteristic: C } = this.hap;
    const cfg = this.device;
    const name = this.accessory.displayName;

    this.toggle(cfg.airQualitySensor !== false && state.quality !== undefined, S.AirQualitySensor, `${name} Air Quality`, undefined, (svc) => {
      this.bind(svc, C.AirQuality, (s) => map.airQuality(s, this.deps.airQualityScale));
      if (state.error !== undefined) {
        this.bind(svc, C.StatusFault, map.statusFault);
      }
    });

    this.toggle(
      cfg.filterMaintenance !== false && (state.filterLife !== undefined || state.filterReplacement !== undefined),
      S.FilterMaintenance,
      `${name} Filter`,
      undefined,
      (svc) => {
        this.bind(svc, C.FilterChangeIndication, map.filterChange);
        if (state.filterLife !== undefined) {
          this.bind(svc, C.FilterLifeLevel, map.filterLifeLevel);
          svc.getCharacteristic(C.ResetFilterIndication).onSet(() => this.write(map.filterResetUpdate(this.state ?? state)));
        }
        this.purifier.addLinkedService(svc);
      },
    );

    const switches: [boolean | undefined, boolean, string, string, (s: State) => boolean, (on: boolean) => Update][] = [
      [cfg.ionizerSwitch, state.ionizer !== undefined, 'ionizer', 'Ionizer', (s) => Boolean(s.ionizer), (on) => ({ ionizer: on })],
      [cfg.pollenModeSwitch, map.supportsPollen(state), 'pollen', 'Pollen Mode', map.pollenOn, map.pollenUpdate],
      [cfg.moodLightSwitch, state.moodlight !== undefined, 'moodlight', 'Mood Light', map.moodLightOn, map.moodLightUpdate],
      [cfg.displayLightsSwitch, state.lights !== undefined, 'lights', 'Display Lights', map.displayLightsOn, map.displayLightsUpdate],
    ];
    for (const [enabled, supported, subtype, label, get, set] of switches) {
      this.toggle(enabled !== false && supported, S.Switch, `${name} ${label}`, subtype, (svc) => {
        this.bind(svc, C.On, get, (v) => set(Boolean(v)));
      });
    }

    const wantLock = cfg.childLock !== false && state.childLock !== undefined;
    const hasLock = this.purifier.testCharacteristic(C.LockPhysicalControls);
    if (wantLock) {
      this.bind(this.purifier, C.LockPhysicalControls, map.childLock, (v) => ({
        childLock: v === map.HK.LockPhysicalControls.ENABLED,
      }));
    } else if (hasLock) {
      this.purifier.removeCharacteristic(this.purifier.getCharacteristic(C.LockPhysicalControls));
      this.unbind(this.purifier, C.LockPhysicalControls);
    }
  }

  private toggle(want: boolean, type: ServiceType, name: string, subtype: string | undefined, setup: (svc: Service) => void): void {
    const existing = this.findService(type, subtype);
    if (!want) {
      if (existing) {
        for (const key of [...this.bindings.keys()]) {
          if (this.bindings.get(key)!.service === existing) {
            this.bindings.delete(key);
            this.pushed.delete(key);
          }
        }
        this.accessory.removeService(existing);
      }
      return;
    }
    const svc = existing ?? this.ensureService(type, name, subtype);
    setup(svc);
  }

  /** Finds a service by type and subtype; services without a subtype only match when none is given. */
  private findService(type: ServiceType, subtype?: string): Service | undefined {
    return this.accessory.services.find((s) => s.UUID === type.UUID && (subtype === undefined ? !s.subtype : s.subtype === subtype));
  }

  private ensureService(type: ServiceType, name: string, subtype?: string): Service {
    const { Characteristic: C } = this.hap;
    let svc = this.findService(type, subtype);
    if (!svc) {
      svc = this.accessory.addService(new type(name, subtype));
      svc.addOptionalCharacteristic(C.ConfiguredName);
      svc.setCharacteristic(C.ConfiguredName, name);
    }
    return svc;
  }

  private bindingKey(service: Service, characteristic: CharacteristicType): string {
    return `${service.UUID}/${service.subtype ?? ''}/${characteristic.UUID}`;
  }

  private bind(service: Service, characteristic: CharacteristicType, get: Getter, set?: (value: CharacteristicValue) => Update): void {
    const key = this.bindingKey(service, characteristic);
    if (this.bindings.has(key)) {
      return;
    }
    const c = service.getCharacteristic(characteristic);
    c.onGet(() => this.read(get));
    if (set) {
      c.onSet((value) => this.write(set(value)));
    }
    this.bindings.set(key, { key, service, characteristic, get });
  }

  private unbind(service: Service, characteristic: CharacteristicType): void {
    const key = this.bindingKey(service, characteristic);
    this.bindings.delete(key);
    this.pushed.delete(key);
  }

  private read(get: Getter): CharacteristicValue {
    if (!this.state || this.failures >= OFFLINE_AFTER) {
      throw new this.hap.HapStatusError(this.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
    return get(this.state);
  }

  private async write(update: Update): Promise<void> {
    try {
      await this.coalescer.queue(update);
    } catch (err) {
      this.deps.log.error(this.prefix(`could not change settings: ${err instanceof Error ? err.message : err}`));
      throw new this.hap.HapStatusError(this.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }

  private async send(update: Update): Promise<void> {
    this.deps.log.debug(this.prefix(`sending ${JSON.stringify(update)}`));
    await this.client.setState(update);
    if (this.state) {
      this.state = applyUpdate(this.state, update);
      this.push();
    }
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(() => void this.poll(), REFRESH_AFTER_WRITE_MS);
  }

  /** Sends changed values to HomeKit. */
  private push(): void {
    if (!this.state) {
      return;
    }
    for (const b of this.bindings.values()) {
      const value = b.get(this.state);
      if (this.pushed.get(b.key) !== value) {
        this.pushed.set(b.key, value);
        b.service.updateCharacteristic(b.characteristic, value);
      }
    }
  }
}
