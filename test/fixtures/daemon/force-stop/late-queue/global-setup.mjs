// Runs on the host before Vitest queues any module, and waits on whatever the host's run hook returns.
export default async function setup() {
  await globalThis[Symbol.for("rt-test.fixture.run-hook")]?.("global-setup");
}
