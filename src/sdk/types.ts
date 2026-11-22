/** Device model numbers. */
export const Model = { MinusA2: 1, BioGS: 2, A3: 3 } as const;
export type Model = (typeof Model)[keyof typeof Model];

/** Mode of operation. Pollen mode is not available on the A3. */
export const Mode = { Auto: 0, Pollen: 1, Manual: 2 } as const;
export type Mode = (typeof Mode)[keyof typeof Mode];

/** Fan speed. SuperSilent is reported by the device but cannot be set. */
export const Speed = { SuperSilent: 0, Silent: 1, Low: 2, Medium: 3, High: 4, Turbo: 5 } as const;
export type Speed = (typeof Speed)[keyof typeof Speed];

/** Speeds that can be set, slowest first. */
export const SETTABLE_SPEEDS: readonly Speed[] = [Speed.Silent, Speed.Low, Speed.Medium, Speed.High, Speed.Turbo];

/** Air quality level as reported by the device (Lowest is not used). */
export const Quality = { Lowest: 0, Low: 1, Medium: 2, High: 3, Highest: 4 } as const;
export type Quality = (typeof Quality)[keyof typeof Quality];

/** Sensor sensitivity. */
export const Sensitivity = { High: 0, Medium: 1, Low: 2 } as const;
export type Sensitivity = (typeof Sensitivity)[keyof typeof Sensitivity];

/** Mood light mode. Value 2 is both Auto and Preset1. */
export const Moodlight = { Off: 0, On: 1, Auto: 2, Preset2: 3, Preset3: 4 } as const;
export type Moodlight = (typeof Moodlight)[keyof typeof Moodlight];

/** Panel light setting (the `all_light_off` field). */
export const Lights = { Off: 0, On: 1, Auto: 2 } as const;
export type Lights = (typeof Lights)[keyof typeof Lights];

/** Timer mode. */
export const TimerMode = { Off: 0, On: 1, Schedule: 2 } as const;
export type TimerMode = (typeof TimerMode)[keyof typeof TimerMode];

/** Filter type. */
export const FilterType = { Unknown: 0, ToxinAbsorber: 1, OdorRemover: 2, GermDefense: 3, PetAllergy: 4 } as const;
export type FilterType = (typeof FilterType)[keyof typeof FilterType];

/** Gas sensor reading. */
export const Gas = { Preheat: 0, Level1: 1, Level2: 2, Level3: 3, Level4: 4 } as const;
export type Gas = (typeof Gas)[keyof typeof Gas];

/** Internal error codes. */
export const DeviceError = {
  NoError: 0,
  DustSensor: 1,
  GasSensor: 2,
  GasAndDust: 3,
  FanLow: 4,
  NFC: 5,
  HallSensor: 8,
} as const;
export type DeviceError = (typeof DeviceError)[keyof typeof DeviceError];

/** Returns the name for a value in one of the enumerations above. */
export function enumName<T extends Record<string, number>>(e: T, value: number | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  for (const [k, v] of Object.entries(e)) {
    if (v === value) {
      return k;
    }
  }
  return `Unknown(${value})`;
}

/** The state data as sent by the device (cmd 4). All fields are optional. */
export interface RawState {
  model?: number;
  firmware?: number[];
  power?: boolean;
  mode?: number;
  speed?: number;
  quality?: number;
  sensitivity?: number;
  ionizer?: boolean;
  idle?: number;
  moodlight?: number;
  sleep?: boolean;
  filter_cleaning?: boolean;
  filter_replacement?: boolean;
  filter_life?: number;
  light_sensor?: boolean;
  particulate_sensor?: number;
  filter_timer?: number;
  all_light_off?: number;
  error?: number;
  tag_state?: number;
  tag_uid?: number[];
  filter_type?: number;
  pm_sensor?: number[];
  color?: number[];
  lsens_ctl?: boolean;
  filter_ctl?: boolean;
  buzzer?: boolean;
  gas?: number;
  lock?: boolean;
  open?: boolean;
  timer_mode?: number;
  timer?: number;
  schedule?: string;
  rssi?: number;
  v?: string;
  [key: string]: unknown;
}

/** Device state with friendlier names. Fields the device did not send are undefined. */
export interface State {
  model?: Model;
  /** Main board firmware, e.g. "3" or "1.0.0.5". */
  mainFirmware?: string;
  /** Wi-Fi board firmware. */
  wifiFirmware?: string;
  power?: boolean;
  mode?: Mode;
  speed?: Speed;
  quality?: Quality;
  sensitivity?: Sensitivity;
  ionizer?: boolean;
  idle?: boolean;
  moodlight?: Moodlight;
  sleep?: boolean;
  filterCleaning?: boolean;
  filterReplacement?: boolean;
  /** Remaining filter life in minutes. */
  filterLife?: number;
  /** Nominal filter life in minutes. */
  filterTimer?: number;
  lightSensor?: boolean;
  particulateSensor?: number;
  lights?: Lights;
  error?: DeviceError;
  filterType?: FilterType;
  pmSensor?: number[];
  color?: number[];
  lightSensorControl?: boolean;
  filterAlert?: boolean;
  buzzer?: boolean;
  gas?: Gas;
  childLock?: boolean;
  panelOpen?: boolean;
  timerMode?: TimerMode;
  /** Minutes remaining until the unit turns off. */
  timer?: number;
  /** 24 character UTC schedule, one speed (0-5, A for auto) per hour. */
  schedule?: string;
  /** Wi-Fi RSSI averaged over an hour. */
  rssi?: number;
  /** The undecoded response. */
  raw: RawState;
}

/** Converts the device's state data into a {@link State}. */
export function parseState(raw: RawState): State {
  let quality = raw.quality as Quality | undefined;
  if (quality !== undefined && raw.model === Model.BioGS) {
    quality = (quality - 1) as Quality;
  }
  return {
    model: raw.model as Model | undefined,
    mainFirmware: raw.firmware?.join('.'),
    wifiFirmware: raw.v,
    power: raw.power,
    mode: raw.mode as Mode | undefined,
    speed: raw.speed as Speed | undefined,
    quality,
    sensitivity: raw.sensitivity as Sensitivity | undefined,
    ionizer: raw.ionizer,
    idle: raw.idle === undefined ? undefined : raw.idle !== 0,
    moodlight: raw.moodlight as Moodlight | undefined,
    sleep: raw.sleep,
    filterCleaning: raw.filter_cleaning,
    filterReplacement: raw.filter_replacement,
    filterLife: raw.filter_life,
    filterTimer: raw.filter_timer,
    lightSensor: raw.light_sensor,
    particulateSensor: raw.particulate_sensor,
    lights: raw.all_light_off as Lights | undefined,
    error: raw.error as DeviceError | undefined,
    filterType: raw.filter_type as FilterType | undefined,
    pmSensor: raw.pm_sensor,
    color: raw.color,
    lightSensorControl: raw.lsens_ctl,
    filterAlert: raw.filter_ctl,
    buzzer: raw.buzzer,
    gas: raw.gas as Gas | undefined,
    childLock: raw.lock,
    panelOpen: raw.open,
    timerMode: raw.timer_mode as TimerMode | undefined,
    timer: raw.timer,
    schedule: raw.schedule,
    rssi: raw.rssi,
    raw,
  };
}

/** Settings to change. Undefined fields are left alone. */
export interface Update {
  power?: boolean;
  mode?: Mode;
  speed?: Speed;
  sensitivity?: Sensitivity;
  ionizer?: boolean;
  moodlight?: Moodlight;
  filterCleaning?: boolean;
  filterReplacement?: boolean;
  /** Remaining filter life in minutes (0-525600). */
  filterLife?: number;
  /** Nominal filter life in minutes (0-525600). */
  filterTimer?: number;
  lights?: Lights;
  /** Mood light palette, 9 values in 0-40. */
  color?: number[];
  lightSensorControl?: boolean;
  filterAlert?: boolean;
  buzzer?: boolean;
  childLock?: boolean;
  timerMode?: TimerMode;
  /** Minutes until the unit turns off (0-1440). */
  timer?: number;
  /** 24 characters, each 0-5 or A. */
  schedule?: string;
}

const WIRE: Record<keyof Update, string> = {
  power: 'power',
  mode: 'mode',
  speed: 'speed',
  sensitivity: 'sensitivity',
  ionizer: 'ionizer',
  moodlight: 'moodlight',
  filterCleaning: 'filter_cleaning',
  filterReplacement: 'filter_replacement',
  filterLife: 'filter_life',
  filterTimer: 'filter_timer',
  lights: 'all_light_off',
  color: 'color',
  lightSensorControl: 'lsens_ctl',
  filterAlert: 'filter_ctl',
  buzzer: 'buzzer',
  childLock: 'lock',
  timerMode: 'timer_mode',
  timer: 'timer',
  schedule: 'schedule',
};

function inRange(name: string, v: number | undefined, min: number, max: number): void {
  if (v !== undefined && (!Number.isInteger(v) || v < min || v > max)) {
    throw new RangeError(`${name} must be an integer in the range ${min}-${max}`);
  }
}

/** Validates an update and converts it to the device's field names. */
export function encodeUpdate(update: Update): Record<string, unknown> {
  if (update.speed === Speed.SuperSilent) {
    throw new RangeError('SuperSilent speed cannot be set');
  }
  inRange('speed', update.speed, 0, 5);
  inRange('mode', update.mode, 0, 2);
  inRange('sensitivity', update.sensitivity, 0, 2);
  inRange('moodlight', update.moodlight, 0, 4);
  inRange('lights', update.lights, 0, 2);
  inRange('timerMode', update.timerMode, 0, 2);
  inRange('filterLife', update.filterLife, 0, 525600);
  inRange('filterTimer', update.filterTimer, 0, 525600);
  inRange('timer', update.timer, 0, 1440);
  if (update.color !== undefined) {
    if (update.color.length !== 9) {
      throw new RangeError('color must have 9 values');
    }
    update.color.forEach((c) => inRange('color', c, 0, 40));
  }
  if (update.schedule !== undefined && !/^[0-5A]{24}$/.test(update.schedule)) {
    throw new RangeError('schedule must be 24 characters, each 0-5 or A');
  }

  const data: Record<string, unknown> = {};
  for (const [key, wire] of Object.entries(WIRE) as [keyof Update, string][]) {
    if (update[key] !== undefined) {
      data[wire] = update[key];
    }
  }
  if (Object.keys(data).length === 0) {
    throw new RangeError('nothing to change');
  }
  return data;
}

/** Applies an update to a state, for optimistic local updates. */
export function applyUpdate(state: State, update: Update): State {
  const raw: RawState = { ...state.raw, ...encodeUpdate(update) };
  return parseState(raw);
}

/** Wi-Fi signal statistics. */
export interface RssiStats {
  cur?: number;
  min?: number;
  max?: number;
  avg?: number;
}

/** Device information (cmd 255). */
export interface Info {
  /** Device ID (the mDNS instance name / Thing ID). */
  name: string;
  /** MAC address, e.g. "AC:67:B2:D2:68:9C". */
  mac: string;
  /** Wi-Fi board firmware. */
  mcu?: string;
  build?: string;
  time?: string;
  uptime?: number;
  mup?: number;
  wup?: number;
  iup?: number;
  cup?: number;
  /** Main board firmware. */
  fv?: string;
  rssi?: RssiStats;
  [key: string]: unknown;
}

/** Uppercases a MAC address and strips separators. */
export function normalizeMac(mac: string): string {
  return mac.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
}
