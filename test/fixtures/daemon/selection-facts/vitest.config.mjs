import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// The test creates setup-link as a directory link to setup before discovery.
const setupLink = join(dirname(fileURLToPath(import.meta.url)), "setup-link");

export default {
  test: {
    globalSetup: ["./setup/global-root.mjs"],
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          globals: true,
          dir: "./unit",
          include: ["**/*.test.mjs"],
          exclude: ["**/skipped/**"],
          includeSource: ["src/**/*.mjs"],
          setupFiles: ["./setup/node-setup.mjs"],
          globalSetup: ["./setup/global-own.mjs"],
          alias: [
            { find: "@shared", replacement: "shared-lib" },
            { find: /^~icons\/(.*)$/i, replacement: "icon-pack/$1" },
            {
              find: "virtual:facts",
              replacement: "facts-module",
              customResolver: () => null,
            },
          ],
        },
      },
      {
        test: {
          name: "bare",
          globals: true,
          include: ["bare/*.test.mjs"],
          globalSetup: ["./setup-link/global-root.mjs"],
        },
      },
      {
        // Absolute, so it is resolved through setup-link on every host rather than against the working directory.
        test: {
          name: "pending",
          globals: true,
          dir: join(setupLink, "later"),
          include: ["**/*.test.mjs"],
        },
      },
      {
        // Its Vite root is its own folder, where the other projects share the consumer root.
        test: {
          name: "rooted",
          globals: true,
          root: "./rooted",
          include: ["*.test.mjs"],
        },
      },
      {
        // Vitest follows a link only in a relative setup path, so these absolute ones keep the link's spelling.
        test: {
          name: "absolute",
          globals: true,
          include: ["bare/*.test.mjs"],
          setupFiles: [join(setupLink, "node-setup.mjs")],
          globalSetup: [join(setupLink, "global-root.mjs")],
        },
      },
    ],
  },
};
