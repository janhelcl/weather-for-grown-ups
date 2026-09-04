export function resolveMeteoFranceBearerToken(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const token = env.WFG_METEO_FRANCE_TOKEN?.trim();
  if (!token) {
    throw new Error(
      "PE-AROME requires WFG_METEO_FRANCE_TOKEN containing a current Météo-France API bearer token",
    );
  }
  return token;
}
