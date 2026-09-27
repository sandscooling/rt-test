import { writeFileSync } from "node:fs";

// Marks that this config was loaded, which a workspace or config the user never confirmed must never be.
writeFileSync(new URL("./loaded", import.meta.url), "");

export default {
  test: {
    globals: true,
    maxWorkers: 1,
    fileParallelism: false,
  },
};
