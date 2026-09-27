import { registerHooks } from "node:module";

const COMPILED_EXTENSION = ".js";
const SOURCE_EXTENSION = ".ts";
const RELATIVE_PREFIX = ".";
/** The repository's `packages/` directory: only its own sources are rewritten, never a consumer's modules. */
const PACKAGES_URL = new URL("../../../", import.meta.url).href;

/** Imported with `--import` by a daemon process running from source, where a relative `.js` import names a `.ts` file. */
registerHooks({
  resolve(specifier, context, nextResolve) {
    const fromPackageSource =
      context.parentURL?.startsWith(PACKAGES_URL) === true &&
      context.parentURL.endsWith(SOURCE_EXTENSION);
    if (
      fromPackageSource &&
      specifier.startsWith(RELATIVE_PREFIX) &&
      specifier.endsWith(COMPILED_EXTENSION)
    ) {
      return nextResolve(
        `${specifier.slice(0, -COMPILED_EXTENSION.length)}${SOURCE_EXTENSION}`,
        context,
      );
    }
    return nextResolve(specifier, context);
  },
});
