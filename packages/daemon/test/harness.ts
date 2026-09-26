import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = fileURLToPath(new URL("../../../", import.meta.url));
const FIXTURES = join(REPO, "test/fixtures/daemon");

/** The repository's own installs: `vitest` is 5.x and `vitest-4` is the aliased 4.1.x. */
export type VitestInstall = "vitest" | "vitest-4";

const repoRequire = createRequire(join(REPO, "package.json"));

export async function inTempDir<T>(
  body: (dir: string) => T | Promise<T>,
): Promise<T> {
  const dir = realpathSync.native(
    mkdtempSync(join(tmpdir(), "rt-test-daemon-")),
  );
  try {
    return await body(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export function copyFixture(name: string, dir: string): void {
  cpSync(join(FIXTURES, name), dir, { recursive: true });
}

/** Makes `vitest` resolve from `dir` to one of the repository's installs, through a directory link. */
export function linkVitest(dir: string, install: VitestInstall): void {
  const target = realpathSync(
    dirname(repoRequire.resolve(`${install}/package.json`)),
  );
  mkdirSync(join(dir, "node_modules"), { recursive: true });
  symlinkSync(target, join(dir, "node_modules/vitest"), "junction");
}

/** A stand-in Vitest install that resolves `vitest/package.json` and `vitest/node` but holds no runner. */
export function fakeVitest(dir: string, version: string): void {
  writeFakeVitest(
    dir,
    JSON.stringify({
      name: "vitest",
      version,
      exports: { "./package.json": "./package.json", "./node": "./node.js" },
    }),
  );
}

/** A stand-in Vitest install whose manifest is exactly `manifest`, with no `vitest/node` unless the manifest exports it. */
export function writeFakeVitest(dir: string, manifest: string): void {
  const root = join(dir, "node_modules/vitest");
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), manifest);
  writeFileSync(join(root, "node.js"), "export {};\n");
}

export function settle<T>(run: () => T): T | { thrown: string } {
  try {
    return run();
  } catch (error) {
    return { thrown: String(error) };
  }
}
