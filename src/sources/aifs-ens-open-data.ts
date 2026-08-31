import type { AifsEnsMember } from "../catalog/aifs-ens.js";
import { aifsEnsPerturbationNumber } from "../catalog/aifs-ens.js";
import { IFS_OPEN_DATA_MIRRORS, type IfsIndexSelector } from "./ifs-open-data.js";

export const AIFS_ENS_OPEN_DATA_MODEL = "aifs-ens" as const;
export type AifsEnsOpenDataProduct = "cf" | "pf";

export function aifsEnsOpenDataProduct(member: AifsEnsMember): AifsEnsOpenDataProduct {
  return member === "c00" ? "cf" : "pf";
}

export function buildAifsEnsOpenDataForecastUrl(
  run: Date,
  forecastHour: number,
  member: AifsEnsMember,
  baseUrl: string = IFS_OPEN_DATA_MIRRORS[0].baseUrl,
): string {
  const date = yyyymmdd(run);
  const hour = run.getUTCHours().toString().padStart(2, "0");
  const product = aifsEnsOpenDataProduct(member);
  return `${baseUrl}/${date}/${hour}z/${AIFS_ENS_OPEN_DATA_MODEL}/0p25/enfo/${date}${hour}0000-${forecastHour}h-enfo-${product}.grib2`;
}

export function buildAifsEnsOpenDataForecastIndexUrl(
  run: Date,
  forecastHour: number,
  member: AifsEnsMember,
  baseUrl: string = IFS_OPEN_DATA_MIRRORS[0].baseUrl,
): string {
  return buildAifsEnsOpenDataForecastUrl(run, forecastHour, member, baseUrl)
    .replace(/\.grib2$/, ".index");
}

export function aifsEnsSelectorsForMember(
  member: AifsEnsMember,
  selectors: readonly IfsIndexSelector[],
): IfsIndexSelector[] {
  const number = aifsEnsPerturbationNumber(member);
  return selectors.map((selector) => {
    const { number: _ignored, ...base } = selector;
    return number === undefined ? base : { ...base, number };
  });
}

function yyyymmdd(date: Date): string {
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
}
