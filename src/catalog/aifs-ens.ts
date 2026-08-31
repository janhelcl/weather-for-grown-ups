import {
  AIFS_AREA_FIELD_IDS,
  AIFS_DERIVED_PRESSURE_VARIABLE_IDS,
  AIFS_FIELD_IDS,
  AIFS_PRESSURE_LEVELS_HPA,
  AIFS_PRESSURE_VARIABLE_IDS,
  AIFS_RAW_PRESSURE_VARIABLE_IDS,
  expandAifsFields,
  expandAifsPressureVariables,
  getAifsCatalog,
  isAifsAreaField,
  isAifsField,
  isAifsPressureLevel,
  isAifsPressureVariable,
  isSupportedAifsPressureSelection,
} from "./aifs.js";

export const AIFS_ENS_MEMBERS = [
  "c00",
  "p01", "p02", "p03", "p04", "p05", "p06", "p07", "p08", "p09", "p10",
  "p11", "p12", "p13", "p14", "p15", "p16", "p17", "p18", "p19", "p20",
  "p21", "p22", "p23", "p24", "p25", "p26", "p27", "p28", "p29", "p30",
  "p31", "p32", "p33", "p34", "p35", "p36", "p37", "p38", "p39", "p40",
  "p41", "p42", "p43", "p44", "p45", "p46", "p47", "p48", "p49", "p50",
] as const;

export type AifsEnsMember = (typeof AIFS_ENS_MEMBERS)[number];

export {
  AIFS_AREA_FIELD_IDS as AIFS_ENS_AREA_FIELD_IDS,
  AIFS_DERIVED_PRESSURE_VARIABLE_IDS as AIFS_ENS_DERIVED_PRESSURE_VARIABLE_IDS,
  AIFS_FIELD_IDS as AIFS_ENS_FIELD_IDS,
  AIFS_PRESSURE_LEVELS_HPA as AIFS_ENS_PRESSURE_LEVELS_HPA,
  AIFS_PRESSURE_VARIABLE_IDS as AIFS_ENS_PRESSURE_VARIABLE_IDS,
  AIFS_RAW_PRESSURE_VARIABLE_IDS as AIFS_ENS_RAW_PRESSURE_VARIABLE_IDS,
  expandAifsFields as expandAifsEnsFields,
  expandAifsPressureVariables as expandAifsEnsPressureVariables,
  isAifsAreaField as isAifsEnsAreaField,
  isAifsField as isAifsEnsField,
  isAifsPressureLevel as isAifsEnsPressureLevel,
  isAifsPressureVariable as isAifsEnsPressureVariable,
  isSupportedAifsPressureSelection as isSupportedAifsEnsPressureSelection,
};

const MEMBER_INDEX = new Map<string, number>(
  AIFS_ENS_MEMBERS.map((member, index) => [member, index]),
);

export function sortAifsEnsMembers(members: readonly AifsEnsMember[]): AifsEnsMember[] {
  return [...members].sort(
    (left, right) => (MEMBER_INDEX.get(left) ?? 999) - (MEMBER_INDEX.get(right) ?? 999),
  );
}

export function aifsEnsPerturbationNumber(member: AifsEnsMember): number | undefined {
  if (member === "c00") return undefined;
  return Number(member.slice(1));
}

export function getAifsEnsCatalog() {
  const base = getAifsCatalog();
  return {
    ...base,
    model: "aifs_ens_0p25" as const,
    members: [...AIFS_ENS_MEMBERS],
    memberSemantics:
      "51-member stochastic AI ensemble: one dedicated AIFS ENS control (c00) plus 50 perturbed members (p01..p50). The control uses unperturbed initial conditions but still contains stochastic model perturbations; AIFS Single is a separate forecast.",
    cadenceNote:
      "AIFS ENS publishes control and 50 perturbed members every 6 hours through f360 for all four daily cycles.",
  };
}
