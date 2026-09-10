/**
 * Maximum multiplicative fan-out that WFG-owned nested orchestration should create
 * for one composed operation. This is deliberately NOT an upstream/network limit:
 * provider access policies remain authoritative and may be much stricter.
 */
export const DEFAULT_COMPOSED_EXECUTION_BUDGET = 32;

export function nestedConcurrency(
  parentConcurrency: number,
  preferredChildConcurrency: number,
  budget = DEFAULT_COMPOSED_EXECUTION_BUDGET,
): number {
  assertPositiveInteger(parentConcurrency, "parentConcurrency");
  assertPositiveInteger(preferredChildConcurrency, "preferredChildConcurrency");
  assertPositiveInteger(budget, "budget");
  if (parentConcurrency > budget) {
    throw new Error(
      `Parent concurrency ${parentConcurrency} exceeds composed execution budget ${budget}`,
    );
  }
  return Math.max(
    1,
    Math.min(preferredChildConcurrency, Math.floor(budget / parentConcurrency)),
  );
}

export function composedFanOut(...concurrencies: readonly number[]): number {
  return concurrencies.reduce((product, value) => {
    assertPositiveInteger(value, "concurrency");
    return product * value;
  }, 1);
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }
}
