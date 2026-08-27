const DAY_MS = 24 * 60 * 60 * 1_000;

export interface ForecastSkillChange {
  field: string;
  delta: number;
  deltaKind: "linear" | "circular_degrees";
}

export interface ForecastSkillPressureLevel {
  pressureHpa: number;
  changes: readonly ForecastSkillChange[];
}

export interface ForecastSkillAccumulator {
  leadHours: number;
  pressureHpa: number;
  field: string;
  deltaKind: "linear" | "circular_degrees";
  count: number;
  sum: number;
  sumAbs: number;
  sumSquares: number;
}

export interface ForecastSkillStatistic {
  leadHours: number;
  pressureHpa: number;
  field: string;
  deltaKind: "linear" | "circular_degrees";
  count: number;
  bias: number;
  mae: number;
  rmse: number;
}

export function accumulateSkillPressureLevels(
  accumulators: Map<string, ForecastSkillAccumulator>,
  leadHours: number,
  pressureLevels: readonly ForecastSkillPressureLevel[],
): void {
  for (const pressure of pressureLevels) {
    for (const change of pressure.changes) {
      const key = [
        leadHours,
        pressure.pressureHpa,
        change.field,
        change.deltaKind,
      ].join("|");
      const current = accumulators.get(key) ?? {
        leadHours,
        pressureHpa: pressure.pressureHpa,
        field: change.field,
        deltaKind: change.deltaKind,
        count: 0,
        sum: 0,
        sumAbs: 0,
        sumSquares: 0,
      };
      current.count += 1;
      current.sum += change.delta;
      current.sumAbs += Math.abs(change.delta);
      current.sumSquares += change.delta * change.delta;
      accumulators.set(key, current);
    }
  }
}

export function finalizeSkillStatistics(
  accumulators: ReadonlyMap<string, ForecastSkillAccumulator>,
): ForecastSkillStatistic[] {
  return [...accumulators.values()]
    .map((accumulator) => ({
      leadHours: accumulator.leadHours,
      pressureHpa: accumulator.pressureHpa,
      field: accumulator.field,
      deltaKind: accumulator.deltaKind,
      count: accumulator.count,
      bias: accumulator.sum / accumulator.count,
      mae: accumulator.sumAbs / accumulator.count,
      rmse: Math.sqrt(accumulator.sumSquares / accumulator.count),
    }))
    .sort((left, right) =>
      left.leadHours - right.leadHours
      || right.pressureHpa - left.pressureHpa
      || left.field.localeCompare(right.field)
    );
}

export function enumerateNominalTimes(
  start: Date,
  end: Date,
  cycleHoursUtc: readonly number[],
): Date[] {
  const hours = [...cycleHoursUtc].sort((left, right) => left - right);
  const day = new Date(Date.UTC(
    start.getUTCFullYear(),
    start.getUTCMonth(),
    start.getUTCDate(),
  ));
  const times: Date[] = [];

  for (let cursor = day; cursor <= end; cursor = new Date(cursor.getTime() + DAY_MS)) {
    for (const hour of hours) {
      const candidate = new Date(Date.UTC(
        cursor.getUTCFullYear(),
        cursor.getUTCMonth(),
        cursor.getUTCDate(),
        hour,
      ));
      if (candidate >= start && candidate <= end) times.push(candidate);
    }
  }
  return times;
}

export function evenlySampleTimes(
  times: readonly Date[],
  maximum: number,
): Date[] {
  if (times.length <= maximum) return [...times];
  if (maximum === 1) return [times[Math.floor((times.length - 1) / 2)]!];

  const sampled: Date[] = [];
  for (let index = 0; index < maximum; index += 1) {
    const sourceIndex = Math.round(index * (times.length - 1) / (maximum - 1));
    sampled.push(times[sourceIndex]!);
  }
  return sampled;
}
