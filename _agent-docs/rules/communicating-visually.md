# Communicating visually

Read this before drawing a diagram or linking an image in a chat reply.

**The chat renders diagrams and images, so use one where a picture genuinely beats a paragraph.** The mechanics are narrow:

| Form                              | Result                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------ |
| A fenced `mermaid` block          | Renders. `flowchart`, `sequenceDiagram`, `stateDiagram-v2` and `erDiagram` all work. |
| `![alt](repo/relative/path.png)`  | Renders, as do `.jpg` and `.svg`; a leading `./` is fine.                            |
| `![alt](C:/absolute/path.png)`    | Broken: absolute drive-letter paths do not resolve.                                  |
| Raw `<svg>` markup, fenced or not | Shows as text.                                                                       |

Paths resolve against the session's working directory, so copy a file from outside the repository in first, under `_agent-docs/.scratch/`.

**The cost is asymmetric.** An image link costs its characters, and the bytes go from disk to the owner's screen without entering your context; a mermaid diagram costs only its source. Reading an image so you can judge it is the expensive direction.

**When a picture wins:**

- **A state machine or lifecycle** → `stateDiagram-v2`. The freshness states of a result, or a defect experiment's verdicts, show an illegal transition as an arrow that should not be there.
- **Entity relationships and cardinality** → `erDiagram`: runs, results, inputs and fingerprints, and which binds to which.
- **Several inputs collapsing into one answer** → `flowchart`: dependency facts, uncertainty and fallbacks resolving into one test selection.
- **A call sequence crossing boundaries** → `sequenceDiagram`: CLI to daemon to Vitest worker and back.
- **Comparative magnitude across categories** → a chart; invoke the `dataviz` skill before writing chart code.

**When it does not.** A linear three-step process is a list. A single number is a sentence. A diagram restating the sentence above it is noise, and a fifteen-node graph gets skimmed rather than corrected. **Draw what you believe so it gets corrected**: a drawing offered as an open question gets a shrug, not an answer.
