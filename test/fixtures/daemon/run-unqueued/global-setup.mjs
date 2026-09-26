export default function setup() {
  return globalThis[Symbol.for("rt-test.fixture.run-hook")]?.("global-setup");
}
