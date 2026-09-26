export declare const FLOW_CONFIG_FILE: string;

export interface FlowScale {
  readonly rule_selection: "whole" | "menu";
  readonly checklist_fanout: 1 | 4;
  readonly sprint_context: boolean;
  readonly ctx_agents: boolean;
  readonly doc_sections: boolean;
  readonly prototype_ui: boolean;
}

export interface FlowConfig {
  readonly root: string;
  readonly ticket_dir: string;
  readonly sprints_dir: string;
  readonly sprint_status: string;
  readonly requirements: string;
  readonly adr_dir: string;
  readonly glossary: string;
  readonly design_decisions_dir: string;
  readonly checklist_dir: string;
  readonly project_context: string;
  readonly rule_maintenance_guide: string;
  readonly rules_dir: string;
  readonly code_change_standards: string;
  readonly adversarial_review_prompt: string;
  readonly scale: FlowScale;
}

export declare function loadFlowConfig(root?: string): FlowConfig;
