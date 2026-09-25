import cognitiveComplexity from "eslint-plugin-sonarjs/cjs/S3776/rule.js";
import { noNonlocalComment } from "./no-nonlocal-comment.mjs";

// The package index loads rules that resolve the hoisted TypeScript 7, which has no compiler API,
// so only the cognitive complexity rule is imported. A rule name carries one severity, so the rule
// is registered twice to give the warn and error tiers separate thresholds.
export default {
  meta: { name: "rt-test" },
  rules: {
    "cognitive-complexity": cognitiveComplexity.rule,
    "cognitive-warn": cognitiveComplexity.rule,
    "no-nonlocal-comment": noNonlocalComment,
  },
};
