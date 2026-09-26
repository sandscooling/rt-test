import { writeFileSync } from "node:fs";

writeFileSync(new URL("./later-collected", import.meta.url), "");

it("later", () => {});
