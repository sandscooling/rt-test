// A test that spawns git, node or oxlint ran up to 1454 ms idle and 7971 ms under a
// loaded full run; this is about four times the loaded figure.
export const PROCESS_SCENARIO_TIMEOUT_MS = 30_000;

export const PROCESS_SCENARIO = { timeout: PROCESS_SCENARIO_TIMEOUT_MS };
