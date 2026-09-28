import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

// Preloaded into an executor a test starts, it acts once the dependency build records that it is about to parse the
// file the hook names: "hold" writes the marker and never returns, as a parse that never ends; "exit" ends the process
// before the record names the file; "remove-and-exit" also removes the record first. A test importing it for its
// constants arms nothing, since the hook acts only in a process whose entry is the executor's.
export const HOOK_VARIABLE = "RT_FIXTURE_BUILD_HOOK";
export const HOOK_EXIT_CODE = 7;
const hook = process.env[HOOK_VARIABLE];
const [, entry] = process.argv;

if (hook !== undefined && /executor-main\.[jt]s$/.test(entry ?? "")) {
  const { at, action, marker } = JSON.parse(hook);
  const paths = new Map();
  const { openSync, writeSync } = fs;
  fs.openSync = (path, ...rest) => {
    const descriptor = openSync(path, ...rest);
    paths.set(descriptor, String(path));
    return descriptor;
  };
  fs.writeSync = (descriptor, data, ...rest) => {
    if (typeof data !== "string" || !data.endsWith(at)) {
      return writeSync(descriptor, data, ...rest);
    }
    if (action === "hold") {
      const written = writeSync(descriptor, data, ...rest);
      fs.writeFileSync(marker, "");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
      return written;
    }
    if (action === "remove-and-exit") fs.rmSync(paths.get(descriptor));
    process.exit(HOOK_EXIT_CODE);
  };
  syncBuiltinESMExports();
}
