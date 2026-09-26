# Implement RT Test in TypeScript on Node

Status: accepted

RT Test drives the consumer's own Vitest, so test discovery, result events, and named-defect transforms run in Node regardless of language. The remaining components (CLI, daemon core, store, watcher and hashing, dependency graph) could be Rust behind the CLI-to-daemon protocol. The value that matters is a correct selection that never runs a test twice, measured against full suites of about ten minutes, so milliseconds count only where agents pay them on every call.

Write every product component in TypeScript on Node. Use `oxc-parser` and `oxc-resolver` from npm for parsing and resolution, which keeps the fast Rust implementation behind a native binding, and SQLite through `node:sqlite`, with `better-sqlite3` as the fallback if the built-in module needs a flag on the supported Node floor. Frame the CLI-to-daemon protocol by line or by length, never by end of stream, and version it, so a client in another language can replace the CLI without daemon changes.

Measured on a Ryzen 7 8700F with Windows 11, Node 24.19, and Rust 1.97.1 against a 3,162-file repository: per-save work stays under 1 ms for typical files (Rust about 0.1 ms), whole-repository hashing and resolution cost the same in both, and a summary over 10,000 results takes about 9 ms at p95 in the daemon in either language. The one gap agents see is CLI start: about 50 ms per call against 8 ms for a Rust binary, which misses an end-to-end reading of a 50 ms summary target at the tail. The project keeps one toolchain, one lint and named-defect path, and the dependency release-age gate that Cargo does not provide.

Revisit when an agent workload shows CLI start cost mattering (add a Rust thin client shipped through `optionalDependencies`), when function-level analysis exceeds 100 ms per edit (add a Rust native addon), or when daemon memory exceeds its budget.
