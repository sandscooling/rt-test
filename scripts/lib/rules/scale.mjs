import { loadBlocks } from "./blocks.mjs";
import { sources } from "./docs.mjs";
import { ruleDocChars } from "./hygiene.mjs";

// Points past which reading the rule docs whole, or judging one menu in one pass, stops being reliable.
export const SCALE_THRESHOLDS = Object.freeze({
  ruleDocChars: 60_000,
  rules: 300,
  fanoutShards: 4,
  fanoutRules: 400,
});

export function scaleSignals(docs) {
  const checklistRules = loadBlocks(docs.checklist).length;
  const contextRules = loadBlocks(docs["project-context"]).length;
  return {
    checklistRules,
    contextRules,
    rules: checklistRules + contextRules,
    ruleDocChars:
      ruleDocChars(docs.checklist) + ruleDocChars(docs["project-context"]),
    shards: sources(docs.checklist).length,
  };
}

function selectionWarnings(signals) {
  const warnings = [];
  if (signals.ruleDocChars > SCALE_THRESHOLDS.ruleDocChars) {
    warnings.push(
      `rule docs total ${signals.ruleDocChars} chars, above ${SCALE_THRESHOLDS.ruleDocChars}, while scale.rule_selection is whole. Consider menu.`,
    );
  }
  if (signals.rules > SCALE_THRESHOLDS.rules) {
    warnings.push(
      `the corpus holds ${signals.rules} rules, above ${SCALE_THRESHOLDS.rules}, while scale.rule_selection is whole. Consider menu.`,
    );
  }
  return warnings;
}

function fanoutWarnings(signals) {
  const crossed =
    signals.shards >= SCALE_THRESHOLDS.fanoutShards ||
    signals.checklistRules > SCALE_THRESHOLDS.fanoutRules;
  if (!crossed) return [];
  return [
    `the checklist has ${signals.shards} shards and ${signals.checklistRules} rules (thresholds ${SCALE_THRESHOLDS.fanoutShards} shards or ${SCALE_THRESHOLDS.fanoutRules} rules) while scale.checklist_fanout is 1. Consider 4.`,
  ];
}

export function scaleWarnings(signals, scale) {
  if (scale.rule_selection === "whole") return selectionWarnings(signals);
  if (scale.checklist_fanout === 1) return fanoutWarnings(signals);
  return [];
}
