import { describe, expect, it } from "vitest";
import {
  buildUnifiedQuery,
  collectBundledDiagnostic,
} from "../src/cli/unified-atmosphere-command.js";
import { queryAtmosphereInputSchema } from "../src/schema/unified-query-input.js";

describe("query CLI diagnostic bundles", () => {
  it("builds one query containing raw-state selection and repeatable canonical diagnostics", () => {
    const layer = collectBundledDiagnostic(
      JSON.stringify({
        kind: "layer",
        lowerPressureHpa: 850,
        upperPressureHpa: 500,
        diagnostics: ["wind_shear", "temperature_lapse_rate"],
      }),
      undefined,
    );
    const diagnostics = collectBundledDiagnostic(
      JSON.stringify({
        kind: "parcel",
        pressureLevelsHpa: [1000, 925, 850, 700, 500, 300],
        parcel: "surface_2m",
      }),
      layer,
    );

    const request = buildUnifiedQuery({
      dataset: "gfs",
      lat: 50.08,
      lon: 14.43,
      at: "2026-09-10T12:00:00Z",
      vars: "temperature,relative_humidity,u_wind,v_wind",
      levels: "1000,925,850,700,500,300",
      fields: "temperature_2m,wind_10m",
      diagnostic: diagnostics,
    });

    expect(queryAtmosphereInputSchema.parse(request)).toMatchObject({
      dataset: "gfs",
      selection: {
        variables: ["temperature", "relative_humidity", "u_wind", "v_wind"],
        pressureLevelsHpa: [1000, 925, 850, 700, 500, 300],
        fields: ["temperature_2m", "wind_10m"],
      },
      diagnostics: [
        {
          kind: "layer",
          lowerPressureHpa: 850,
          upperPressureHpa: 500,
          diagnostics: ["wind_shear", "temperature_lapse_rate"],
        },
        {
          kind: "parcel",
          pressureLevelsHpa: [1000, 925, 850, 700, 500, 300],
          parcel: "surface_2m",
        },
      ],
    });
  });

  it("rejects malformed or non-canonical --diagnostic values at the CLI boundary", () => {
    expect(() => collectBundledDiagnostic("not-json", undefined))
      .toThrow(/valid JSON/);
    expect(() => collectBundledDiagnostic(
      JSON.stringify({ kind: "layer", lowerPressureHpa: 850, upperPressureHpa: 500 }),
      undefined,
    )).toThrow(/canonical atmospheric diagnostic selector/);
  });
});
