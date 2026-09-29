#!/usr/bin/env node
/**
 * Checks the named-defect catalog without running a test: every `D###` test has exactly one record,
 * every record names a test, and every mutation anchor matches its file exactly once. A lane proves
 * the defects it writes or touches with `verify-defects.mjs --ids` or `--edited`; this is the push
 * gate's cheap half, so a record whose code moved fails here rather than going unnoticed.
 */
import { loadCatalog } from "./lib/defects/catalog.mjs";

const { defects } = loadCatalog(process.cwd());
console.log(
  `${defects.length} named defects: each test has one record and each anchor matches once.`,
);
