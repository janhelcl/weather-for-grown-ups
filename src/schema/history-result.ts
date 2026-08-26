import * as z from "zod/v4";
import { historicalAnalysisTimeSchema, historicalGfsVariableIdSchema } from "./history.js";
import { gridPointSchema, profileLevelResultSchema } from "./result.js";

export const historicalProfileResultSchema = z.object({
  model: z.literal("gfs_grid4_analysis_0p5"),
  analysisTime: historicalAnalysisTimeSchema,
  requestedPoint: gridPointSchema,
  gridPoint: gridPointSchema,
  selection: z.object({
    variables: z.array(historicalGfsVariableIdSchema).min(1),
    pressureLevelsHpa: z.array(z.number().positive()).min(1),
  }),
  levels: z.array(profileLevelResultSchema).min(1),
  source: z.object({
    provider: z.literal("NOAA NCEI"),
    access: z.literal("ncei_thredds_ncss"),
    dataset: z.string().min(1),
    cacheHit: z.boolean(),
  }),
  caveat: z.literal("GFS model analysis; not a direct observation or homogeneous climatological reanalysis"),
});

export type HistoricalProfileResult = z.infer<typeof historicalProfileResultSchema>;
