import { UnsupportedOperationError } from "../failure.js";

export function resolveMeteoFranceBearerToken(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const token = env.WFG_METEO_FRANCE_TOKEN?.trim();
  if (!token) {
    throw new UnsupportedOperationError(
      "PE-AROME requires WFG_METEO_FRANCE_TOKEN containing a current Météo-France API bearer token; "
      + "this environment has no PE-AROME credentials configured",
      { details: { dataset: "pe-arome", missingEnv: ["WFG_METEO_FRANCE_TOKEN"] } },
    );
  }
  return token;
}
