/**
 * The edit corpus's sequences as data. Each edit declares the Vitest workspaces the selection rule gives for the paths
 * it changes (the package workspace holding each path and every workspace depending on it; nothing for a declared
 * non-input or a save that changes no bytes), and every failure a full run finds after it, an earlier edit's included.
 * The fixture's graph: `packages/lib` under `packages/ui` and `packages/backend`, all three under `apps/web`.
 */

export const EDIT_CORPUS_FIXTURE = "edit-corpus";

export const LIB = "packages/lib";
export const UI = "packages/ui";
export const BACKEND = "packages/backend";
export const WEB = "apps/web";

export const CHANGE = {
  /** Replaces the one occurrence of `from` in the file. */
  replace: "replace",
  create: "create",
  delete: "delete",
  /** Deletes the file and writes its content at `to`, in one burst. */
  rename: "rename",
  /** Writes the file's own bytes back unchanged. */
  resave: "resave",
} as const;

/** Paths are relative to the consumer root, `/`-separated. */
export type FileChange =
  | {
      readonly kind: typeof CHANGE.replace;
      readonly path: string;
      readonly from: string;
      readonly to: string;
    }
  | {
      readonly kind: typeof CHANGE.create;
      readonly path: string;
      readonly content: string;
    }
  | { readonly kind: typeof CHANGE.delete; readonly path: string }
  | {
      readonly kind: typeof CHANGE.rename;
      readonly path: string;
      readonly to: string;
    }
  | { readonly kind: typeof CHANGE.resave; readonly path: string };

/** A test by its workspace, its module relative to the workspace, and its suite and test names. */
export interface DeclaredTest {
  readonly workspacePath: string;
  readonly modulePath: string;
  readonly names: readonly string[];
}

export interface DeclaredModule {
  readonly workspacePath: string;
  readonly modulePath: string;
}

/** Every failure a full run finds after the edit: tests that fail, and modules that fail to load. */
export interface DeclaredFailures {
  readonly tests: readonly DeclaredTest[];
  readonly modules: readonly DeclaredModule[];
}

export interface CorpusEdit {
  readonly name: string;
  readonly changes: readonly FileChange[];
  /** Saved once a declared workspace is seen running, or once the wait on `changes` has answered. */
  readonly duringRun?: readonly FileChange[];
  readonly declaredRuns: readonly string[];
  readonly declaredFailures: DeclaredFailures;
}

export interface CorpusSequence {
  readonly name: string;
  readonly edits: readonly CorpusEdit[];
}

export const NO_FAILURES: DeclaredFailures = { tests: [], modules: [] };

/** The Vitest workspaces the fixture holds, each of which a start confirms. */
export const CORPUS_WORKSPACES: readonly string[] = [LIB, UI, BACKEND, WEB];

const PRICING = `${LIB}/src/pricing.mjs`;
const LIB_INDEX = `${LIB}/src/index.mjs`;
const UI_LABEL = `${UI}/src/label.mjs`;
const BACKEND_QUOTE = `${BACKEND}/src/quote.mjs`;
const BACKEND_CONFIG = `${BACKEND}/vitest.config.mjs`;
const WEB_CART_TEST = "test/cart.test.mjs";
const WEB_CHECKOUT_TEST = "test/checkout.test.mjs";

const UI_LABEL_FAILS: DeclaredTest = {
  workspacePath: UI,
  modulePath: "test/label.test.mjs",
  names: ["label", "labels the total"],
};
const WEB_LABEL_FAILS: DeclaredTest = {
  workspacePath: WEB,
  modulePath: WEB_CHECKOUT_TEST,
  names: ["checkout", "labels the order"],
};

const REFUND_TEST = "test/refund.test.mjs";
const REFUND_TEST_CONTENT = `import { describe, expect, it } from "vitest";
import { quote } from "../src/quote.mjs";

describe("refund", () => {
  it("refunds the whole amount", () => {
    expect(-quote(1).amount).toBe(5);
  });
});
`;
const REFUND_FAILS: DeclaredTest = {
  workspacePath: BACKEND,
  modulePath: REFUND_TEST,
  names: ["refund", "refunds the whole amount"],
};

export const SHARED_LIBRARY: CorpusSequence = {
  name: "shared library",
  edits: [
    {
      name: "lib's unit price raised",
      changes: [
        {
          kind: CHANGE.replace,
          path: PRICING,
          from: "UNIT_PRICE = 5",
          to: "UNIT_PRICE = 6",
        },
      ],
      declaredRuns: CORPUS_WORKSPACES,
      declaredFailures: {
        tests: [
          {
            workspacePath: LIB,
            modulePath: "test/pricing.test.mjs",
            names: ["price", "charges five per unit"],
          },
          UI_LABEL_FAILS,
          {
            workspacePath: BACKEND,
            modulePath: "test/quote.test.mjs",
            names: ["quote", "quotes the amount"],
          },
          WEB_LABEL_FAILS,
        ],
        modules: [],
      },
    },
    {
      name: "lib's unit price restored",
      changes: [
        {
          kind: CHANGE.replace,
          path: PRICING,
          from: "UNIT_PRICE = 6",
          to: "UNIT_PRICE = 5",
        },
      ],
      declaredRuns: CORPUS_WORKSPACES,
      declaredFailures: NO_FAILURES,
    },
    {
      name: "lib's pricing saved with its bytes unchanged",
      changes: [{ kind: CHANGE.resave, path: PRICING }],
      declaredRuns: [],
      declaredFailures: NO_FAILURES,
    },
  ],
};

const LABEL_BROKEN: DeclaredFailures = {
  tests: [UI_LABEL_FAILS, WEB_LABEL_FAILS],
  modules: [],
};
const LABEL_AND_REFUND_BROKEN: DeclaredFailures = {
  tests: [UI_LABEL_FAILS, WEB_LABEL_FAILS, REFUND_FAILS],
  modules: [],
};

export const INSIDE_PACKAGES: CorpusSequence = {
  name: "inside packages",
  edits: [
    {
      name: "ui's label prefix changed",
      changes: [
        {
          kind: CHANGE.replace,
          path: UI_LABEL,
          from: 'LABEL_PREFIX = "Total"',
          to: 'LABEL_PREFIX = "Sum"',
        },
      ],
      declaredRuns: [UI, WEB],
      declaredFailures: LABEL_BROKEN,
    },
    {
      name: "a test module holding a failing test added to backend",
      changes: [
        {
          kind: CHANGE.create,
          path: `${BACKEND}/${REFUND_TEST}`,
          content: REFUND_TEST_CONTENT,
        },
      ],
      declaredRuns: [BACKEND, WEB],
      declaredFailures: LABEL_AND_REFUND_BROKEN,
    },
    {
      name: "web's cart test module deleted",
      changes: [{ kind: CHANGE.delete, path: `${WEB}/${WEB_CART_TEST}` }],
      declaredRuns: [WEB],
      declaredFailures: LABEL_AND_REFUND_BROKEN,
    },
  ],
};

const OLD_PRICING_IMPORT = '"@corpus/lib/pricing"';
const NEW_PRICING_IMPORT = '"@corpus/lib/prices"';

export const RENAME: CorpusSequence = {
  name: "rename",
  edits: [
    {
      name: "lib's pricing file renamed with web's import of it left",
      changes: [
        { kind: CHANGE.rename, path: PRICING, to: `${LIB}/src/prices.mjs` },
        {
          kind: CHANGE.replace,
          path: LIB_INDEX,
          from: '"./pricing.mjs"',
          to: '"./prices.mjs"',
        },
        {
          kind: CHANGE.replace,
          path: UI_LABEL,
          from: OLD_PRICING_IMPORT,
          to: NEW_PRICING_IMPORT,
        },
      ],
      declaredRuns: CORPUS_WORKSPACES,
      declaredFailures: {
        tests: [],
        modules: [{ workspacePath: WEB, modulePath: WEB_CART_TEST }],
      },
    },
    {
      name: "web's import of the renamed file fixed",
      changes: [
        {
          kind: CHANGE.replace,
          path: `${WEB}/${WEB_CART_TEST}`,
          from: OLD_PRICING_IMPORT,
          to: NEW_PRICING_IMPORT,
        },
      ],
      declaredRuns: [WEB],
      declaredFailures: NO_FAILURES,
    },
    {
      name: "the root and lib's docs edited",
      changes: [
        {
          kind: CHANGE.replace,
          path: "README.md",
          from: "A synthetic consumer",
          to: "A committed synthetic consumer",
        },
        {
          kind: CHANGE.replace,
          path: `${LIB}/README.md`,
          from: "by its quantity",
          to: "by the quantity ordered",
        },
      ],
      declaredRuns: [],
      declaredFailures: NO_FAILURES,
    },
  ],
};

export const CONFIG_AND_RUN_IN_PROGRESS: CorpusSequence = {
  name: "config and a run in progress",
  edits: [
    {
      name: "backend's Vitest config raises its test timeout",
      changes: [
        {
          kind: CHANGE.replace,
          path: BACKEND_CONFIG,
          from: "testTimeout: 5_000",
          to: "testTimeout: 10_000",
        },
      ],
      declaredRuns: [BACKEND, WEB],
      declaredFailures: NO_FAILURES,
    },
    {
      name: "backend's currency changed, and web's test updated while a run is going",
      changes: [
        {
          kind: CHANGE.replace,
          path: BACKEND_QUOTE,
          from: 'CURRENCY = "USD"',
          to: 'CURRENCY = "EUR"',
        },
      ],
      duringRun: [
        {
          kind: CHANGE.replace,
          path: `${WEB}/${WEB_CHECKOUT_TEST}`,
          from: '.toBe("USD")',
          to: '.toBe("EUR")',
        },
      ],
      declaredRuns: [BACKEND, WEB],
      declaredFailures: NO_FAILURES,
    },
  ],
};

export const EDIT_CORPUS: readonly CorpusSequence[] = [
  SHARED_LIBRARY,
  INSIDE_PACKAGES,
  RENAME,
  CONFIG_AND_RUN_IN_PROGRESS,
];
