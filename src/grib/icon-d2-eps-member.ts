import type { GribMessage } from "@mattnucc/gribberish";
import {
  ICON_D2_EPS_MEMBERS,
  iconD2EpsMemberOrdinal,
  type IconD2EpsMember,
} from "../catalog/icon-d2-eps.js";
import type { DecodedValue, GribDecoderName } from "../core/types.js";
import {
  decodePointMessages,
  gridPointsInBox,
  readGribMessages,
  selectMessage,
  summarizeMessageInBox,
  temporalForSelector,
} from "./gribberish-runtime.js";
import {
  Wgrib2GridDecoder,
  type GridValuePoint,
  type SelectedGridValues,
} from "./wgrib2-grid.js";
import {
  Wgrib2StatsDecoder,
  type AreaBox,
  type AreaMessageSelector,
  type GridStatistics,
  type SelectedGridStatistics,
} from "./wgrib2-stats.js";

const EXPECTED_MEMBER_COUNT = ICON_D2_EPS_MEMBERS.length;

export class IconD2EpsMemberReader {
  private readonly cache = new Map<string, Promise<GribMessage[]>>();

  constructor(private readonly maxCachedPaths = 2) {}

  async readMember(path: string, member: IconD2EpsMember): Promise<GribMessage[]> {
    const messages = await this.read(path);
    const ensembleCounts = [...new Set(
      messages
        .map((message) => message.numberOfEnsembleMembers)
        .filter((value): value is number => value !== null),
    )];
    if (
      ensembleCounts.length > 0
      && ensembleCounts.some((count) => count !== EXPECTED_MEMBER_COUNT)
    ) {
      throw new Error(
        `ICON-D2-EPS GRIB declares unexpected ensemble size(s): ${ensembleCounts.join(", ")}`,
      );
    }

    const perturbations = [...new Set(
      messages
        .map((message) => message.perturbationNumber)
        .filter((value): value is number => value !== null),
    )].sort((left, right) => left - right);

    if (perturbations.length !== EXPECTED_MEMBER_COUNT) {
      throw new Error(
        `ICON-D2-EPS GRIB contains ${perturbations.length} perturbation numbers; expected ${EXPECTED_MEMBER_COUNT}`,
      );
    }

    const ordinal = iconD2EpsMemberOrdinal(member);
    const sourceNumber = perturbations[ordinal - 1];
    if (sourceNumber === undefined) {
      throw new Error(`ICON-D2-EPS member ${member} has no source perturbation number`);
    }

    const selected = messages.filter(
      (message) => message.perturbationNumber === sourceNumber,
    );
    if (selected.length === 0) {
      throw new Error(
        `ICON-D2-EPS GRIB contains no messages for member ${member} (perturbation ${sourceNumber})`,
      );
    }
    return selected;
  }

  private async read(path: string): Promise<GribMessage[]> {
    const cached = this.cache.get(path);
    if (cached !== undefined) {
      this.cache.delete(path);
      this.cache.set(path, cached);
      return cached;
    }

    const pending = readGribMessages(path);
    this.cache.set(path, pending);
    while (this.cache.size > this.maxCachedPaths) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined || oldest === path) break;
      this.cache.delete(oldest);
    }
    try {
      return await pending;
    } catch (error) {
      this.cache.delete(path);
      throw error;
    }
  }
}

export class IconD2EpsMemberPointDecoder {
  readonly engine: GribDecoderName = "gribberish";

  constructor(
    private readonly member: IconD2EpsMember,
    private readonly reader: IconD2EpsMemberReader,
  ) {}

  async extractPoint(
    path: string,
    longitude: number,
    latitude: number,
  ): Promise<DecodedValue[]> {
    const decoded = decodePointMessages(
      await this.reader.readMember(path, this.member),
      longitude,
      latitude,
    );
    if (decoded.length === 0) {
      throw new Error(`ICON-D2-EPS member ${this.member} returned no supported point values`);
    }
    return decoded;
  }
}

export class IconD2EpsMemberStatsDecoder extends Wgrib2StatsDecoder {
  constructor(
    private readonly member: IconD2EpsMember,
    private readonly reader: IconD2EpsMemberReader,
  ) {
    super(undefined);
  }

  override async summarizeBox(path: string, box: AreaBox): Promise<GridStatistics> {
    const messages = await this.reader.readMember(path, this.member);
    if (messages.length !== 1) {
      throw new Error(
        `ICON-D2-EPS member area distribution expected exactly one GRIB record, found ${messages.length}`,
      );
    }
    return summarizeMessageInBox(messages[0]!, box);
  }

  override async summarizeSelectedMessage(
    path: string,
    box: AreaBox,
    selector: AreaMessageSelector,
  ): Promise<SelectedGridStatistics> {
    const message = selectMessage(
      await this.reader.readMember(path, this.member),
      selector,
    );
    return {
      ...summarizeMessageInBox(message, box),
      temporal: temporalForSelector(message, selector),
    };
  }
}

export class IconD2EpsMemberGridDecoder extends Wgrib2GridDecoder {
  constructor(
    private readonly member: IconD2EpsMember,
    private readonly reader: IconD2EpsMemberReader,
  ) {
    super(undefined);
  }

  override async extractBox(path: string, box: AreaBox): Promise<GridValuePoint[]> {
    const messages = await this.reader.readMember(path, this.member);
    if (messages.length !== 1) {
      throw new Error(
        `ICON-D2-EPS member area distribution expected exactly one GRIB record, found ${messages.length}`,
      );
    }
    return gridPointsInBox(messages[0]!, box);
  }

  override async extractSelectedMessage(
    path: string,
    box: AreaBox,
    selector: AreaMessageSelector,
  ): Promise<SelectedGridValues> {
    const message = selectMessage(
      await this.reader.readMember(path, this.member),
      selector,
    );
    return {
      points: gridPointsInBox(message, box),
      temporal: temporalForSelector(message, selector),
    };
  }
}
