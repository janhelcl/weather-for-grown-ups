import type { AigefsMember } from "../catalog/aigefs.js";
import type { AifsEnsMember } from "../catalog/aifs-ens.js";
import type { IfsEnsMember } from "../catalog/ifs-ens.js";
import type { GefsMember } from "../catalog/gefs.js";
import type { PointCoordinate } from "../schema/query.js";
import { InvalidRequestError } from "../failure.js";

export const DEFAULT_LEVELS = "1000,925,850,700,500";

/**
 * Commander option parser for one numeric value. `Number("abc")` silently yields
 * NaN and surfaces later as an opaque schema failure; fail here with the flag name.
 */
export function numberOption(flag: string): (value: string) => number {
  return (value) => parseNumber(value, flag);
}

export function parseNumber(value: unknown, flag: string): number {
  const text = String(value).trim();
  const parsed = text.length === 0 ? Number.NaN : Number(text);
  if (!Number.isFinite(parsed)) {
    throw new InvalidRequestError(
      `Expected ${flag} to be a number, received: ${String(value)}`,
      { details: { option: flag, received: String(value) } },
    );
  }
  return parsed;
}

export function parseNumberList(value: unknown, flag: string): number[] {
  const items = String(value).split(",").map((item) => item.trim()).filter(Boolean);
  if (items.length === 0) {
    throw new InvalidRequestError(`Expected ${flag} to contain at least one number`, {
      details: { option: flag, received: String(value) },
    });
  }
  return items.map((item) => parseNumber(item, flag));
}

export function parseStringList(value: unknown): string[] {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

export function collectPoint(value: string, previous: PointCoordinate[] | undefined): PointCoordinate[] {
  return [...(previous ?? []), parseCoordinate(value, "--point")];
}

export function parseCoordinate(value: unknown, flag: string): PointCoordinate {
  const parts = String(value).split(",").map((part) => part.trim());
  if (parts.length !== 2) {
    throw new InvalidRequestError(`Expected ${flag} lat,lon, received: ${String(value)}`, {
      details: { option: flag, received: String(value) },
    });
  }
  const latitude = Number(parts[0]);
  const longitude = Number(parts[1]);
  if (parts[0] === "" || parts[1] === "" || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new InvalidRequestError(`Expected numeric ${flag} lat,lon, received: ${String(value)}`, {
      details: { option: flag, received: String(value) },
    });
  }
  return { latitude, longitude };
}

export function parseGefsMembers(value: unknown): GefsMember[] {
  return parseStringList(value) as GefsMember[];
}

export function parseAigefsMembers(value: unknown): AigefsMember[] {
  return parseStringList(value) as AigefsMember[];
}

export function parseAifsEnsMembers(value: unknown): AifsEnsMember[] {
  return parseStringList(value) as AifsEnsMember[];
}

export function parseIfsEnsMembers(value: unknown): IfsEnsMember[] {
  return parseStringList(value) as IfsEnsMember[];
}

/** @deprecated prefer parseNumberList with the flag name for actionable errors. */
export function parseNumbers(value: unknown): number[] {
  return String(value).split(",").map((item) => item.trim()).filter(Boolean).map(Number);
}

/** @deprecated prefer parseNumberList with the flag name for actionable errors. */
export function parseLevels(value: unknown): number[] {
  return parseNumbers(value);
}
