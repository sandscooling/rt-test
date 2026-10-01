// The code most canaries mutate. Each mutation in `canaries.json` that names this file replaces text that occurs
// exactly once here.

export function bodyValue() {
  return "body";
}

export function matcherValue() {
  return "matcher";
}

export function declaredValue() {
  return "declared";
}

export function survivorValue() {
  return "survivor";
}

export function unparsedValue() {
  return "unparsed";
}

export function uncalledValue() {
  return "uncalled";
}

let shared;

export function storeShared() {
  shared = "shared";
}

export function readShared() {
  return shared;
}

export function typeErrorValue() {
  return "type-error";
}

export function timeoutValue() {
  return "timeout";
}

export function countedValues() {
  return ["count"];
}

export function snapshotValue() {
  return "snapshot";
}

export function undeclaredValue() {
  return "undeclared";
}

export function leakValue() {
  return "leak";
}

export function mixedValue() {
  return "mixed";
}

export function beforeEachValue() {
  return "before-each";
}

export function afterEachValue() {
  return "after-each";
}

export function beforeAllValue() {
  return "before-all";
}

export function concurrentValue() {
  return "concurrent";
}

export function cleanupValue() {
  return "cleanup";
}

function requireLoadable(loadable) {
  if (!loadable) throw new Error("the subject module failed to load");
}

requireLoadable(true);
