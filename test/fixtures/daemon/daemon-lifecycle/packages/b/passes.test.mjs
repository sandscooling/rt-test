import { spawnsChildren, startHeartbeat } from "../a/children.mjs";

// With `spawn-children` present in `packages/a`, the test starts a heartbeat child from its forked worker.
it("passes", async () => {
  if (spawnsChildren()) await startHeartbeat(`b-test-${process.pid}`);
});
