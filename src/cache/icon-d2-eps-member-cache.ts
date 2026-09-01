import type { IconD2EpsMember } from "../catalog/icon-d2-eps.js";
import type {
  IconD2AvailabilityRequirement,
  IconD2DataRequest,
  IconD2SourceFile,
  IconD2SubsetCache,
} from "./icon-d2-open-data-cache.js";
import { IconD2EpsMemberFileFilter } from "./icon-d2-eps-open-data-cache.js";
import { IconD2EpsCdoRemapper } from "./icon-d2-eps-remap-cache.js";

/**
 * Most ICON-D2-EPS parameters are remapped once as an all-members object and
 * split afterward. DWD DBZ_CMAX is an exception: CDO drops its perturbation
 * metadata when remapping the all-members object, so that parameter must be
 * split by member first and only then remapped.
 *
 * Keep this provider quirk in the cache/source layer. The public field and
 * member semantics remain identical whichever ordering is required upstream.
 */
export class IconD2EpsAdaptiveMemberSubsetCache implements IconD2SubsetCache {
  constructor(
    private readonly source: IconD2SubsetCache,
    private readonly remapper: IconD2EpsCdoRemapper,
    private readonly filter: IconD2EpsMemberFileFilter,
    private readonly member: IconD2EpsMember,
  ) {}

  async fetch(request: IconD2DataRequest): Promise<IconD2SourceFile> {
    const sourceFile = await this.source.fetch(request);
    if (requiresMemberFirstRemap(request)) {
      const memberFile = await this.filter.filter(sourceFile.path, this.member);
      const remapped = await this.remapper.remap(memberFile.path);
      return {
        path: remapped.path,
        cacheHit: sourceFile.cacheHit && memberFile.cacheHit && remapped.cacheHit,
      };
    }

    const remapped = await this.remapper.remap(sourceFile.path);
    const memberFile = await this.filter.filter(remapped.path, this.member);
    return {
      path: memberFile.path,
      cacheHit: sourceFile.cacheHit && remapped.cacheHit && memberFile.cacheHit,
    };
  }

  isForecastAvailable(
    run: Date,
    forecastHour: number,
    requirement: IconD2AvailabilityRequirement,
  ): Promise<boolean> {
    return this.source.isForecastAvailable(run, forecastHour, requirement);
  }
}

export function iconD2EpsRequiresMemberFirstRemap(
  request: IconD2DataRequest,
): boolean {
  return request.fields.some((field) => field.id === "column_maximum_reflectivity");
}

function requiresMemberFirstRemap(request: IconD2DataRequest): boolean {
  return iconD2EpsRequiresMemberFirstRemap(request);
}
