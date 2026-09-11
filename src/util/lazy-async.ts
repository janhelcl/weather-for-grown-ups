/** Share initialization, never request results. A failed load can be retried. */
export function lazyAsync<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => {
    pending ??= Promise.resolve().then(load).catch((error: unknown) => {
      pending = undefined;
      throw error;
    });
    return pending;
  };
}
