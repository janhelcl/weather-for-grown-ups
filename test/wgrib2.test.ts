import { execa } from "execa";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SUPPORTED_GFS_CODES } from "../src/catalog/variables.js";
import { parseWgrib2PointLine, Wgrib2Decoder } from "../src/grib/wgrib2.js";

vi.mock("execa", () => ({ execa: vi.fn() }));
const execaMock = vi.mocked(execa);

beforeEach(() => { execaMock.mockReset(); });

describe("parseWgrib2PointLine", () => {
  it.each(SUPPORTED_GFS_CODES)("parses supported code %s", (code) => {
    const line = `12:12345:d=2026081906:${code}:850 mb:6 hour fcst:lon=14.5,lat=50,val=285.4`;
    expect(parseWgrib2PointLine(line)).toEqual({
      code, pressureHpa: 850, value: 285.4, gridPoint: { longitude: 14.5, latitude: 50 },
    });
  });

  it("parses scientific notation and a published fractional pressure level", () => {
    const line = "1:1:d=2026081906:O3MR:0.1 mb:6 hour fcst:lon=359.75,lat=-12.5,val=-1.2e-06";
    expect(parseWgrib2PointLine(line)).toEqual({
      code: "O3MR", pressureHpa: 0.1, value: -1.2e-6, gridPoint: { longitude: -0.25, latitude: -12.5 },
    });
  });

  it("keeps 180 degrees signed longitude unchanged", () => {
    expect(parseWgrib2PointLine("1:1:d=2026081906:TMP:500 mb:6 hour fcst:lon=180,lat=0,val=250")?.gridPoint.longitude).toBe(180);
  });

  it.each([
    "",
    "1:0:d=2026081906:NOTREAL:850 mb:6 hour fcst:lon=14.5,lat=50,val=1500",
    "1:0:d=2026081906:TMP:850 mb:6 hour fcst:val=285",
    "1:0:d=2026081906:TMP:850 mb:6 hour fcst:lon=14.5,lat=50",
  ])("ignores unsupported or malformed line: %s", (line) => {
    expect(parseWgrib2PointLine(line)).toBeNull();
  });
});

describe("Wgrib2Decoder", () => {
  it("invokes wgrib2 with -s -lon and converts negative longitude to 0-360", async () => {
    execaMock.mockResolvedValue({ stdout: "1:1:d=2026081906:TMP:850 mb:6 hour fcst:lon=350,lat=50,val=285.4" } as never);
    const values = await new Wgrib2Decoder("/opt/wgrib2").extractPoint("/tmp/test.grib2", -10, 50);
    expect(execaMock).toHaveBeenCalledWith("/opt/wgrib2", ["/tmp/test.grib2", "-s", "-lon", "350", "50"]);
    expect(values[0]?.gridPoint.longitude).toBe(-10);
  });

  it("parses multiple supported output lines and skips noise", async () => {
    execaMock.mockResolvedValue({ stdout: [
      "noise",
      "1:1:d=2026081906:HGT:850 mb:6 hour fcst:lon=14.5,lat=50,val=1500",
      "2:2:d=2026081906:VVEL:850 mb:6 hour fcst:lon=14.5,lat=50,val=-0.2",
    ].join("\n") } as never);
    await expect(new Wgrib2Decoder().extractPoint("field.grib2", 14.5, 50)).resolves.toHaveLength(2);
  });

  it("fails clearly when wgrib2 returns no supported point values", async () => {
    execaMock.mockResolvedValue({ stdout: "only unsupported output" } as never);
    await expect(new Wgrib2Decoder().extractPoint("field.grib2", 14.5, 50)).rejects.toThrow(/no supported point values/);
  });

  it("translates ENOENT into an actionable installation error", async () => {
    execaMock.mockRejectedValue(new Error("spawn wgrib2 ENOENT"));
    await expect(new Wgrib2Decoder().extractPoint("field.grib2", 14.5, 50)).rejects.toThrow(/wgrib2 is required but was not found/);
  });

  it("rethrows non-ENOENT process errors", async () => {
    const error = new Error("permission denied");
    execaMock.mockRejectedValue(error);
    await expect(new Wgrib2Decoder().extractPoint("field.grib2", 14.5, 50)).rejects.toBe(error);
  });
});
