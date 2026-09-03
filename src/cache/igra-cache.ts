import { createHash } from "node:crypto";
import {
  NCEI_IGRA_STATION_LIST_URL,
  NceiIgraSource,
  parseIgraSounding,
  parseIgraStationList,
  resolveIgraSoundingArchive,
  type IgraSounding,
  type IgraStation,
} from "../sources/ncei-igra.js";
import { FileArtifactCache } from "./artifact-cache.js";

const DAY_MS = 24 * 60 * 60 * 1_000;

export class CachedNceiIgraSource {
  private readonly cache: FileArtifactCache;

  constructor(
    rootDir: string,
    private readonly source: NceiIgraSource,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.cache = new FileArtifactCache(rootDir);
  }

  async listStations(): Promise<IgraStation[]> {
    const response = await this.cache.getOrCreateText(
      "igra2-station-list.txt",
      () => this.source.fetchStationListText(),
      DAY_MS,
    );
    return parseIgraStationList(response.value);
  }

  async getSounding(stationId: string, nominalTime: Date): Promise<IgraSounding> {
    const archive = resolveIgraSoundingArchive(stationId, nominalTime, this.now());
    const response = await this.cache.getOrCreateBytes(
      `${createHash("sha256").update(archive.url).digest("hex")}.zip`,
      () => this.source.fetchSoundingArchive(archive.url),
      archive.recent ? 6 * 60 * 60 * 1_000 : 30 * DAY_MS,
    );
    const parsed = parseIgraSounding(
      this.source.extractSoundingArchive(response.value),
      stationId,
      nominalTime,
    );
    return {
      ...parsed,
      sourceFile: archive.url,
      cacheHit: response.cacheHit,
    };
  }
}
