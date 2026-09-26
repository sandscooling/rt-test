# Call no model; route defect suggestions through the coding agent

Status: accepted

After falsification works, RT Test adds two kinds of test suggestion: mechanical suggestions derived from its own data, and defects a language model proposes. A built-in model call would put source on the network, need credentials and a budget, and make a verifier's output nondeterministic, while the coding agent that asks already runs a model with the author's context.

RT Test calls no model and sends no source, results, or environment values off the machine. It emits its gap report through the JSON CLI; the coding agent proposes defects and tests from it; RT Test verifies what it proposes. A suggestion becomes a named defect only when the author accepts it into the defect definitions. A built-in, opt-in model call needs explicit product approval and an ADR superseding this one.

Rejected: a built-in model client, for the egress, credential, and determinism costs above. Revisit when the owner approves a built-in call, for example for use without a coding agent.

Enforcement: the checklist check that no code sends data off the machine, carrying a lint-hardening candidate for a ban on outbound network APIs in product packages.
