import { upstreamHttpFailure } from "../access/http-failure.js";
import { WFG_USER_AGENT } from "../access/user-agent.js";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  FileAccessPolicy,
  UPSTREAM_ACCESS_POLICIES,
  type UpstreamAccessPolicy,
} from "../access/access-policy.js";
import { fetchWithRetry } from "../access/http-fetch.js";
import type {
  AigfsAvailabilityRequirement,
  AigfsDataRequest,
  AigfsSourceFile,
  AigfsSubsetCache,
} from "./aigfs-nomads-subset-cache.js";
import type { AigefsMember } from "../catalog/aigefs.js";
import {
  mergeByteRanges,
  parseGribIndex,
  selectNonIsobaricByteRanges,
  selectPressureByteRanges,
  type ByteRange,
} from "../grib/index.js";
import {
  buildAigefsS3IndexUrl,
  buildAigefsS3Url,
  type AigefsProduct,
} from "../sources/aigefs.js";

export class AigefsS3SubsetCache implements AigfsSubsetCache {
  private readonly memberInFlight = new Map<string, Promise<AigfsSourceFile>>();

  constructor(
    private readonly memberRootDir: string,
    readonly member: AigefsMember,
    private readonly memberFetchFn: typeof fetch = globalThis.fetch,
    private readonly memberAccessPolicy: UpstreamAccessPolicy = new FileAccessPolicy(
      join(memberRootDir, "access-state"),
      UPSTREAM_ACCESS_POLICIES.noaaAws,
    ),
  ) {}

  async fetch(request: AigfsDataRequest): Promise<AigfsSourceFile> {
    if (request.variables.length === 0 && request.fields.length === 0) {
      throw new Error(
        "AIGEFS subset request must contain at least one pressure variable or surface field",
      );
    }

    await mkdir(this.memberRootDir, { recursive: true });
    const key = subsetKey(this.member, request);
    const path = join(this.memberRootDir, `${key}.grib2`);
    if (await exists(path)) return { path, cacheHit: true };

    const pending = this.memberInFlight.get(key);
    if (pending) {
      const result = await pending;
      return { ...result, cacheHit: true };
    }

    const operation = this.downloadMember(request, path)
      .finally(() => this.memberInFlight.delete(key));
    this.memberInFlight.set(key, operation);
    return operation;
  }

  async isForecastAvailable(
    run: Date,
    forecastHour: number,
    requirement: AigfsAvailabilityRequirement,
  ): Promise<boolean> {
    if (!requirement.pressure && !requirement.surface) return false;
    if (
      requirement.pressure
      && !(await this.hasMemberIndex(run, forecastHour, "pres"))
    ) return false;
    if (
      requirement.surface
      && !(await this.hasMemberIndex(run, forecastHour, "sfc"))
    ) return false;
    return true;
  }

  private async downloadMember(
    request: AigfsDataRequest,
    path: string,
  ): Promise<AigfsSourceFile> {
    const chunks: Uint8Array[] = [];

    if (request.variables.length > 0) {
      const ranges = await this.selectedRanges(request, "pres");
      chunks.push(
        ...(await this.fetchRanges(
          buildAigefsS3Url(request.run, request.forecastHour, this.member, "pres"),
          ranges,
        )),
      );
    }

    if (request.fields.length > 0) {
      const ranges = await this.selectedRanges(request, "sfc");
      chunks.push(
        ...(await this.fetchRanges(
          buildAigefsS3Url(request.run, request.forecastHour, this.member, "sfc"),
          ranges,
        )),
      );
    }

    const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const combined = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.byteLength;
    }

    const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, combined);
      await rename(tempPath, path);
    } catch (error) {
      await rm(tempPath, { force: true });
      throw error;
    }
    return { path, cacheHit: false };
  }

  private async selectedRanges(
    request: AigfsDataRequest,
    product: AigefsProduct,
  ): Promise<ByteRange[]> {
    const indexText = await this.fetchMemberIndex(
      request.run,
      request.forecastHour,
      product,
    );
    const records = parseGribIndex(indexText);
    const ranges = product === "pres"
      ? selectPressureByteRanges(
          records,
          request.variables.map((variable) => variable.gfsCode),
          request.pressureLevelsHpa,
        )
      : selectNonIsobaricByteRanges(records, request.fields);
    return coalesceAdjacentRanges(mergeByteRanges(ranges));
  }

  private async fetchMemberIndex(
    run: Date,
    forecastHour: number,
    product: AigefsProduct,
  ): Promise<string> {
    const url = buildAigefsS3IndexUrl(run, forecastHour, this.member, product);
    const path = this.indexPath(url);
    try {
      return await readFile(path, "utf8");
    } catch {
      // AIGEFS forecast objects are immutable after publication.
    }

    await mkdir(this.memberRootDir, { recursive: true });
    const response = await fetchWithRetry(
      url,
      { headers: { "user-agent": WFG_USER_AGENT } },
      { fetchFn: this.memberFetchFn, accessPolicy: this.memberAccessPolicy },
    );
    if (!response.ok) {
      throw upstreamHttpFailure({
        provider: "NOAA AWS Open Data",
        operation: `AIGEFS ${this.member} index request`,
        status: response.status,
        statusText: response.statusText,
        resource: `AIGEFS member ${this.member} for run ${run.toISOString()} f${String(forecastHour).padStart(3, "0")}`,
        details: { run: run.toISOString(), forecastHour, member: this.member, product },
      });
    }
    const text = await response.text();
    await writeFile(path, text, "utf8");
    return text;
  }

  private async hasMemberIndex(
    run: Date,
    forecastHour: number,
    product: AigefsProduct,
  ): Promise<boolean> {
    const url = buildAigefsS3IndexUrl(run, forecastHour, this.member, product);
    const path = this.indexPath(url);
    if (await exists(path)) return true;

    await mkdir(this.memberRootDir, { recursive: true });
    const response = await fetchWithRetry(
      url,
      { headers: { "user-agent": WFG_USER_AGENT } },
      { fetchFn: this.memberFetchFn, accessPolicy: this.memberAccessPolicy },
    );
    if (response.status === 404) return false;
    if (!response.ok) {
      throw upstreamHttpFailure({
        provider: "NOAA AWS Open Data",
        operation: `AIGEFS ${this.member} availability request`,
        status: response.status,
        statusText: response.statusText,
      });
    }
    const text = await response.text();
    await writeFile(path, text, "utf8");
    return true;
  }

  private async fetchRanges(
    url: string,
    ranges: readonly ByteRange[],
  ): Promise<Uint8Array[]> {
    if (ranges.length === 0) throw new Error("AIGEFS index selection returned no byte ranges");
    const chunks: Uint8Array[] = [];
    for (const range of ranges) {
      const rangeValue = `bytes=${range.start}-${range.end ?? ""}`;
      const response = await fetchWithRetry(
        url,
        {
          headers: {
            range: rangeValue,
            "user-agent": WFG_USER_AGENT,
          },
        },
        { fetchFn: this.memberFetchFn, accessPolicy: this.memberAccessPolicy },
      );
      if (response.status !== 206) {
        throw upstreamHttpFailure({
          provider: "NOAA AWS Open Data",
          operation: `AIGEFS ${this.member} byte-range request`,
          status: response.status,
          statusText: response.statusText,
        });
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (
        bytes.length < 4
        || new TextDecoder().decode(bytes.slice(0, 4)) !== "GRIB"
      ) {
        throw new Error(
          `AIGEFS NOAA EAGLE range did not start with a GRIB message (${rangeValue})`,
        );
      }
      chunks.push(bytes);
    }
    return chunks;
  }

  private indexPath(url: string): string {
    return join(
      this.memberRootDir,
      `${createHash("sha256").update(url).digest("hex")}.idx`,
    );
  }
}

function subsetKey(member: AigefsMember, request: AigfsDataRequest): string {
  const canonical = JSON.stringify({
    member,
    run: request.run.toISOString(),
    forecastHour: request.forecastHour,
    variables: [...new Set(request.variables.map((variable) => variable.gfsCode))].sort(),
    pressureLevelsHpa: [...new Set(request.pressureLevelsHpa)].sort((a, b) => b - a),
    fields: [...new Set(request.fields.map((field) => field.id))].sort(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function coalesceAdjacentRanges(ranges: readonly ByteRange[]): ByteRange[] {
  const sorted = [...ranges].sort((left, right) => left.start - right.start);
  const result: ByteRange[] = [];
  for (const range of sorted) {
    const previous = result.at(-1);
    if (
      previous !== undefined
      && previous.end !== undefined
      && range.start <= previous.end + 1
    ) {
      if (range.end === undefined) delete previous.end;
      else previous.end = range.end;
      continue;
    }
    result.push({ ...range });
  }
  return result;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
