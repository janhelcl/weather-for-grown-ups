import type { GefsMember, GefsProfileVariableId } from "../catalog/gefs.js";
import type { AtmosphericModelId } from "../catalog/models.js";
import type { GefsEnsembleProfileResult } from "../schema/gefs-ensemble-profile.js";
import type { GridPoint, ProfileLevel, ProfileResult } from "./types.js";

export interface AtmosphericProfileSnapshot {
  model: AtmosphericModelId;
  run: string;
  validTime: string;
  forecastHour: number;
  requestedPoint: GridPoint;
  gridPoint: GridPoint;
  member?: GefsMember;
  levels: ProfileLevel[];
}

export function fromGfsProfile(profile: ProfileResult): AtmosphericProfileSnapshot {
  return {
    model: profile.model,
    run: profile.run,
    validTime: profile.validTime,
    forecastHour: profile.forecastHour,
    requestedPoint: profile.requestedPoint,
    gridPoint: profile.gridPoint,
    levels: profile.levels,
  };
}

export function fromGefsMemberProfiles(profile: GefsEnsembleProfileResult): AtmosphericProfileSnapshot[] {
  if (!profile.members) {
    throw new Error("GEFS member profile adaptation requires includeMembers=true");
  }
  return profile.members.map((memberProfile) => ({
    model: profile.model,
    run: profile.run,
    validTime: profile.validTime,
    forecastHour: profile.forecastHour,
    requestedPoint: profile.requestedPoint,
    gridPoint: profile.gridPoint,
    member: memberProfile.member,
    levels: memberValuesToLevels(profile.selection.pressureLevelsHpa, memberProfile.values),
  }));
}

export function memberValuesToLevels(
  pressureLevelsHpa: readonly number[],
  values: readonly { variable: GefsProfileVariableId; pressureLevelHpa: number; value: number }[],
): ProfileLevel[] {
  return pressureLevelsHpa.map((pressureHpa) => {
    const level: ProfileLevel = { pressureHpa };
    for (const value of values) {
      if (value.pressureLevelHpa === pressureHpa) setPressureValue(level, value.variable, value.value);
    }
    return level;
  });
}

function setPressureValue(level: ProfileLevel, variable: GefsProfileVariableId, value: number): void {
  switch (variable) {
    case "temperature": level.temperatureC = value; return;
    case "relative_humidity": level.relativeHumidityPct = value; return;
    case "u_wind": level.uWindMs = value; return;
    case "v_wind": level.vWindMs = value; return;
    case "geopotential_height": level.geopotentialHeightGpm = value; return;
    case "vertical_velocity": level.verticalVelocityPaS = value; return;
    case "dew_point": level.dewPointC = value; return;
    case "potential_temperature": level.potentialTemperatureK = value; return;
    case "specific_humidity": level.specificHumidityKgKg = value; return;
    case "mixing_ratio": level.mixingRatioKgKg = value; return;
    case "virtual_temperature": level.virtualTemperatureC = value; return;
    case "air_density": level.airDensityKgM3 = value; return;
    case "wet_bulb_temperature": level.wetBulbTemperatureC = value; return;
    case "equivalent_potential_temperature": level.equivalentPotentialTemperatureK = value; return;
  }
}
