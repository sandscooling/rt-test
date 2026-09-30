import { EventEmitter } from "node:events";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

// Preloaded into every process a daemon test starts, it acts only in the daemon: every watch opens and reports
// nothing, as when the watcher has not yet reported a save, so the daemon sees an edit only by reading it itself.
const [, entry] = process.argv;

if (entry?.endsWith("daemon-main.ts")) {
  fs.watch = () =>
    Object.assign(new EventEmitter(), {
      close() {},
      ref() {
        return this;
      },
      unref() {
        return this;
      },
    });
  syncBuiltinESMExports();
}
