import { registerHooks } from "node:module";

// Preloaded ahead of an import, it prints every module URL the process resolved once the process ends.
const resolved = new Set();

registerHooks({
  resolve(specifier, context, nextResolve) {
    const result = nextResolve(specifier, context);
    resolved.add(result.url);
    return result;
  },
});

process.on("exit", () => {
  process.stdout.write(JSON.stringify([...resolved]));
});
