export type Settled<T> = T | { readonly thrown: string };

// A crash must reach the assertion as a value: the defect checker counts only an assertion failure.
export function settle<T>(run: () => T): Settled<T> {
  try {
    return run();
  } catch (error) {
    return { thrown: String(error) };
  }
}
