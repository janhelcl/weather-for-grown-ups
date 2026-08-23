import { describe, expect, it, vi } from "vitest";
import {
  GefsS3RunProbe,
  buildGefsS3ForecastIndexUrl,
  buildGefsS3ForecastUrl,
} from "../src/sources/gefs-s3.js";

const run = new Date("2026-08-23T12:00:00Z");

describe("GEFS NOAA AWS paths", () => {
  it("builds canonical control and perturbed pgrb2a URLs", () => {
    expect(buildGefsS3ForecastUrl(run, 6, "c00")).toBe(
      "https://noaa-gefs-pds.s3.amazonaws.com/gefs.20260823/12/atmos/pgrb2ap5/gec00.t12z.pgrb2a.0p50.f006",
    );
    expect(buildGefsS3ForecastUrl(run, 123, "p07")).toBe(
      "https://noaa-gefs-pds.s3.amazonaws.com/gefs.20260823/12/atmos/pgrb2ap5/gep07.t12z.pgrb2a.0p50.f123",
    );
    expect(buildGefsS3ForecastIndexUrl(run, 6, "p01")).toBe(
      "https://noaa-gefs-pds.s3.amazonaws.com/gefs.20260823/12/atmos/pgrb2ap5/gep01.t12z.pgrb2a.0p50.f006.idx",
    );
  });

  it("requires every requested member to be published", async () => {
    const fetchFn = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      return new Response(null, { status: url.includes("gep02") ? 404 : 200 });
    }) as typeof fetch;
    const probe = new GefsS3RunProbe(fetchFn);

    await expect(probe.areMembersAvailable(run, 6, ["c00", "p01"])).resolves.toBe(true);
    await expect(probe.areMembersAvailable(run, 6, ["c00", "p02"])).resolves.toBe(false);
    expect(fetchFn).toHaveBeenCalledWith(expect.stringContaining(".idx"), expect.objectContaining({ method: "HEAD" }));
  });
});
