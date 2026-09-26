import { writeFileSync } from "node:fs";

writeFileSync(new URL("./loaded", import.meta.url), "");

export default {
  test: { globals: true },
};
