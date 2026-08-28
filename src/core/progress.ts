export type AtmosphericProgressPhase = "start" | "step" | "complete";

export interface AtmosphericStepProgress {
  dataset: "gfs";
  operation: "time_series" | "points_time_series";
  phase: AtmosphericProgressPhase;
  completedSteps: number;
  totalSteps: number;
  source: "s3" | "nomads";
  forecastHour?: number;
  validTime?: string;
  cacheHit?: boolean;
}

export type AtmosphericProgressReporter = (progress: AtmosphericStepProgress) => void;
