const UNHANDLED_REJECTION = "unhandledRejection";

/**
 * Runs `body` with Vitest's unhandled-rejection listeners set aside, and resolves with the reason of each rejection
 * nobody handled until the event-loop turn after it ends, so a test asserts there were none rather than the run failing
 * outside any assertion. Node reports such a rejection once the microtasks of the turn that made it have run.
 */
export async function unhandledRejectionsDuring(
  body: () => Promise<void>,
): Promise<unknown[]> {
  const reasons: unknown[] = [];
  const record = (reason: unknown): void => {
    reasons.push(reason);
  };
  const vitestListeners = process.listeners(UNHANDLED_REJECTION);
  process.removeAllListeners(UNHANDLED_REJECTION);
  process.on(UNHANDLED_REJECTION, record);
  try {
    await body();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    process.off(UNHANDLED_REJECTION, record);
    for (const listener of vitestListeners) {
      process.on(UNHANDLED_REJECTION, listener);
    }
  }
  return reasons;
}
