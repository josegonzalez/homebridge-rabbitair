/**
 * Pure conversions between Rabbit Air state and HomeKit characteristic
 * values. HomeKit enum values are spelled out here so the logic can be
 * tested without Homebridge.
 */
import { Lights, Mode, Model, Moodlight, SETTABLE_SPEEDS, Speed, type State, type Update } from './sdk/index.js';

export const HK = {
  Active: { INACTIVE: 0, ACTIVE: 1 },
  CurrentAirPurifierState: { INACTIVE: 0, IDLE: 1, PURIFYING_AIR: 2 },
  TargetAirPurifierState: { MANUAL: 0, AUTO: 1 },
  AirQuality: { UNKNOWN: 0, EXCELLENT: 1, GOOD: 2, FAIR: 3, INFERIOR: 4, POOR: 5 },
  FilterChangeIndication: { FILTER_OK: 0, CHANGE_FILTER: 1 },
  LockPhysicalControls: { DISABLED: 0, ENABLED: 1 },
  StatusFault: { NO_FAULT: 0, GENERAL_FAULT: 1 },
} as const;

/**
 * Which way the device's air quality number runs. The protocol names the
 * values Lowest..Highest but does not document whether a higher value means
 * cleaner or dirtier air.
 */
export type AirQualityScale = 'higherIsBetter' | 'higherIsWorse';

export function active(state: State): number {
  return state.power ? HK.Active.ACTIVE : HK.Active.INACTIVE;
}

export function currentPurifierState(state: State): number {
  if (!state.power) {
    return HK.CurrentAirPurifierState.INACTIVE;
  }
  if (state.idle) {
    return HK.CurrentAirPurifierState.IDLE;
  }
  return HK.CurrentAirPurifierState.PURIFYING_AIR;
}

/** Auto maps to AUTO. Manual and Pollen map to MANUAL; Pollen has its own switch. */
export function targetPurifierState(state: State): number {
  return state.mode === Mode.Auto ? HK.TargetAirPurifierState.AUTO : HK.TargetAirPurifierState.MANUAL;
}

export function targetPurifierUpdate(value: number): Update {
  return { power: true, mode: value === HK.TargetAirPurifierState.AUTO ? Mode.Auto : Mode.Manual };
}

/**
 * Fan speed as a percentage: the five settable speeds are 20% steps and
 * SuperSilent, which cannot be set, reads as 1%. Off reads as 0%.
 */
export function rotationSpeed(state: State): number {
  if (!state.power || state.speed === undefined) {
    return 0;
  }
  if (state.speed === Speed.SuperSilent) {
    return 1;
  }
  const index = SETTABLE_SPEEDS.indexOf(state.speed);
  return index === -1 ? 0 : Math.round(((index + 1) * 100) / SETTABLE_SPEEDS.length);
}

/** Converts a percentage into an update. 0% turns the purifier off. */
export function rotationSpeedUpdate(percent: number): Update {
  if (percent <= 0) {
    return { power: false };
  }
  const index = Math.min(SETTABLE_SPEEDS.length, Math.ceil((percent * SETTABLE_SPEEDS.length) / 100)) - 1;
  return { power: true, speed: SETTABLE_SPEEDS[Math.max(0, index)] };
}

const QUALITY_BETTER = [HK.AirQuality.POOR, HK.AirQuality.INFERIOR, HK.AirQuality.FAIR, HK.AirQuality.GOOD, HK.AirQuality.EXCELLENT];

export function airQuality(state: State, scale: AirQualityScale): number {
  if (state.quality === undefined || state.quality < 0 || state.quality > 4) {
    return HK.AirQuality.UNKNOWN;
  }
  const index = scale === 'higherIsBetter' ? state.quality : 4 - state.quality;
  return QUALITY_BETTER[index]!;
}

export function statusFault(state: State): number {
  return state.error ? HK.StatusFault.GENERAL_FAULT : HK.StatusFault.NO_FAULT;
}

export function filterChange(state: State): number {
  return state.filterReplacement ? HK.FilterChangeIndication.CHANGE_FILTER : HK.FilterChangeIndication.FILTER_OK;
}

/** Remaining filter life as a percentage of the nominal filter life. */
export function filterLifeLevel(state: State): number {
  if (state.filterLife === undefined || !state.filterTimer) {
    return 100;
  }
  return Math.max(0, Math.min(100, Math.round((state.filterLife / state.filterTimer) * 100)));
}

/** Resets the remaining filter life to the nominal filter life. */
export function filterResetUpdate(state: State): Update {
  return { filterLife: state.filterTimer ?? 525600, filterReplacement: false };
}

export function childLock(state: State): number {
  return state.childLock ? HK.LockPhysicalControls.ENABLED : HK.LockPhysicalControls.DISABLED;
}

/** Pollen mode exists on every model except the A3. */
export function supportsPollen(state: State): boolean {
  return state.mode !== undefined && state.model !== Model.A3;
}

export function pollenOn(state: State): boolean {
  return state.mode === Mode.Pollen;
}

/** Turning Pollen mode off returns to Auto. */
export function pollenUpdate(on: boolean): Update {
  return on ? { power: true, mode: Mode.Pollen } : { mode: Mode.Auto };
}

/** The mood light is on in any mode except Off. */
export function moodLightOn(state: State): boolean {
  return state.moodlight !== undefined && state.moodlight !== Moodlight.Off;
}

export function moodLightUpdate(on: boolean): Update {
  return { moodlight: on ? Moodlight.On : Moodlight.Off };
}

/** The panel lights are on in On and Auto. */
export function displayLightsOn(state: State): boolean {
  return state.lights !== undefined && state.lights !== Lights.Off;
}

export function displayLightsUpdate(on: boolean): Update {
  return { lights: on ? Lights.On : Lights.Off };
}
