import type { Files } from "./catalog.mjs";

export declare function importClosures(
  files: Files,
): (start: string) => ReadonlySet<string>;
