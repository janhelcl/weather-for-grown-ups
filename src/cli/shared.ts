import type { AigefsMember } from "../catalog/aigefs.js";
import type { AifsEnsMember } from "../catalog/aifs-ens.js";
import type { IfsEnsMember } from "../catalog/ifs-ens.js";
import type { GefsMember } from "../catalog/gefs.js";
import type { PointCoordinate } from "../schema/query.js";

export const DEFAULT_LEVELS = "1000,925,850,700,500";

export function collectPoint(value: string, previous: PointCoordinate[] | undefined): PointCoordinate[] {
  const parts = value.split(",").map((part) => part.trim());
  if (parts.length !== 2) throw new Error(`Expected --point lat,lon, received: ${value}`);
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error(`Expected numeric --point lat,lon, received: ${value}`);
  }
  return [...(previous ?? []), { latitude, longitude }];
}

export function parseGefsMembers(value: unknown): GefsMember[] {
  return String(value).split(",").map((member) => member.trim()).filter(Boolean) as GefsMember[];
}

export function parseAigefsMembers(value: unknown): AigefsMember[] {
  return String(value).split(",").map((member) => member.trim()).filter(Boolean) as AigefsMember[];
}

export function parseAifsEnsMembers(value: unknown): AifsEnsMember[] {
  return String(value).split(",").map((member) => member.trim()).filter(Boolean) as AifsEnsMember[];
}

export function parseIfsEnsMembers(value: unknown): IfsEnsMember[] {
  return String(value).split(",").map((member) => member.trim()).filter(Boolean) as IfsEnsMember[];
}

export function parseNumbers(value: unknown): number[] {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean).map(Number);
}

export function parseLevels(value: unknown): number[] {
  return String(value).split(",").map((level) => level.trim()).filter(Boolean).map(Number);
}
