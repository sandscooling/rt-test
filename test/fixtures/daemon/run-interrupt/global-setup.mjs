export default function setup() {
  globalThis[Symbol.for("rt-test.fixture.run-hook")]?.("global-setup");
}
