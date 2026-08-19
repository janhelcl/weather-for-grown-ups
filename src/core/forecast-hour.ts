const GFS_RUN_HOURS = new Set([0, 6, 12, 18]);

export function parseGfsRun(value: string): Date {
  const run = new Date(value);
  if (Number.isNaN(run.getTime())) throw new Error(`Invalid GFS run: ${value}`);

  if (
    !GFS_RUN_HOURS.has(run.getUTCHours()) ||
    run.getUTCMinutes() !== 0 ||
    run.getUTCSeconds() !== 0 ||
    run.getUTCMilliseconds() !== 0
  ) {
    throw new Error("GFS run must be initialized at 00Z, 06Z, 12Z, or 18Z");
  }

  return run;
}

export function forecastHour(run: Date, validTime: Date): number {
  const hours = (validTime.getTime() - run.getTime()) / 3_600_000;
  if (!Number.isInteger(hours) || hours < 0) {
    throw new Error("validTime must be a whole forecast hour at or after run time");
  }
  if (hours > 384) throw new Error("GFS forecast hour must be <= 384");
  if (hours > 120 && hours % 3 !== 0) {
    throw new Error("After forecast hour 120, GFS 0.25° output is available every 3 hours");
  }
  return hours;
}
