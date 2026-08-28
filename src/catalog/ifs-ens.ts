export const IFS_ENS_MEMBERS = [
  "p01", "p02", "p03", "p04", "p05", "p06", "p07", "p08", "p09", "p10",
  "p11", "p12", "p13", "p14", "p15", "p16", "p17", "p18", "p19", "p20",
  "p21", "p22", "p23", "p24", "p25", "p26", "p27", "p28", "p29", "p30",
  "p31", "p32", "p33", "p34", "p35", "p36", "p37", "p38", "p39", "p40",
  "p41", "p42", "p43", "p44", "p45", "p46", "p47", "p48", "p49", "p50",
] as const;

export type IfsEnsMember = (typeof IFS_ENS_MEMBERS)[number];

export function ifsEnsMemberNumber(member: IfsEnsMember): number {
  return Number(member.slice(1));
}

export function sortIfsEnsMembers(members: readonly IfsEnsMember[]): IfsEnsMember[] {
  return [...members].sort((left, right) => ifsEnsMemberNumber(left) - ifsEnsMemberNumber(right));
}

export function getIfsEnsCatalog() {
  return {
    model: "ifs_ens_0p25" as const,
    provider: "ECMWF Open Data" as const,
    horizontalGridDegrees: 0.25 as const,
    cyclesUtc: [0, 6, 12, 18] as const,
    members: [...IFS_ENS_MEMBERS],
    memberSemantics:
      "50 perturbed ENS members. Since ECMWF Cycle 50r1 the unperturbed control is the deterministic oper/fc forecast, exposed separately by WFG as dataset 'ifs'.",
    cadenceNote:
      "00/12Z ENS runs are 3-hourly through f144 then 6-hourly through f360; 06/18Z ENS runs are 3-hourly through f144.",
  };
}
