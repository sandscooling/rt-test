import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

// Stores each test file's snapshots under __custom__/ beside it, rather than Vitest's __snapshots__/.
export default {
  getVersion: () => "1",
  getHeader: () =>
    "// Vitest Snapshot v1, https://vitest.dev/guide/snapshot.html",
  resolvePath: async (filepath) =>
    join(dirname(filepath), "__custom__", `${basename(filepath)}.snap`),
  resolveRawPath: async (testPath, rawPath) =>
    isAbsolute(rawPath) ? rawPath : resolve(dirname(testPath), rawPath),
  saveSnapshotFile: async (filepath, snapshot) => {
    mkdirSync(dirname(filepath), { recursive: true });
    writeFileSync(filepath, snapshot);
  },
  readSnapshotFile: async (filepath) =>
    existsSync(filepath) ? readFileSync(filepath, "utf8") : null,
  removeSnapshotFile: async (filepath) => {
    rmSync(filepath, { force: true });
  },
};
