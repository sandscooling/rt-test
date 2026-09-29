import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  SHELL,
  unleasedHeavyRuns,
  type HeavyRunOptions,
} from "../../../scripts/lib/orchestration/heavy-command.mjs";
import { heavyRunDenial } from "../../../scripts/lib/orchestration/lease-cli.mjs";
import { withTemp } from "./harness.js";
import { alive, HOLDER_PID, NOW, owner, writeLease } from "./lease-harness.js";

const QUEUE_SENTENCE =
  "To queue, run it as: node scripts/run-lease.mjs run --lane <group> --thread <threadId> -- bun run check";

// Each command's unleased heavy segments, with no target naming an existing file unless `options` says so.
const judged = (commands: readonly string[], options: HeavyRunOptions = {}) =>
  commands.map((command) =>
    unleasedHeavyRuns(command, { isFile: () => false, ...options }),
  );

// A heavy command of one segment comes back whole, as written.
const asWritten = (commands: readonly string[]) =>
  commands.map((command) => [command]);

describe("heavy package scripts", () => {
  it("D2309: judges the check and named-defect scripts heavy", () => {
    const commands = [
      "bun run check",
      "bun run test:defects",
      "bun run test:defects:changed",
      "bun check",
    ];
    expect(judged(commands)).toEqual(asWritten(commands));
  });

  it("D2310: finds the script behind bun's own flags", () => {
    const commands = [
      "bun --silent run test:run",
      "bun --cwd packages/core run check",
    ];
    expect(judged(commands)).toEqual(asWritten(commands));
  });

  it("D2311: judges npm test and its aliases heavy", () => {
    const commands = ["npm test", "npm t", "npm run test:run"];
    expect(judged(commands)).toEqual(asWritten(commands));
  });

  it("D2312: judges a pnpm or yarn script named without run heavy", () => {
    const commands = ["pnpm test:defects", "yarn check"];
    expect(judged(commands)).toEqual(asWritten(commands));
  });

  it("D2313: judges the defect verifier run directly by node heavy", () => {
    const bash = "node scripts/verify-defects.mjs";
    const powershell = "node scripts\\verify-defects.mjs --jobs 2";
    const seen = [
      ...judged([bash]),
      ...judged([powershell], { shell: SHELL.POWERSHELL }),
    ];
    expect(seen).toEqual([[bash], [powershell]]);
  });

  it("D2637: judges the defect verifier heavy when it names --ids or --edited", () => {
    const bash = [
      "node scripts/verify-defects.mjs --ids D2611,D2612",
      "node scripts/verify-defects.mjs --edited",
    ];
    const powershell = [
      "node scripts\\verify-defects.mjs --ids D2611,D2612",
      "node scripts\\verify-defects.mjs --edited",
    ];
    const seen = [
      ...judged(bash),
      ...judged(powershell, { shell: SHELL.POWERSHELL }),
    ];
    expect(seen).toEqual([...asWritten(bash), ...asWritten(powershell)]);
  });

  it("D2319: leaves bun's own test runner alone", () => {
    expect(judged(["bun test"])).toEqual([[]]);
  });

  it("D2320: leaves a bun --filter run alone, in either spelling", () => {
    expect(
      judged([
        "bun run --filter @rt-test/core test",
        "bun --filter=@rt-test/core run test:run",
      ]),
    ).toEqual([[], []]);
  });
});

describe("Vitest targets", () => {
  it("D2314: judges a Vitest run over a directory or a name filter heavy", () => {
    const commands = [
      "bun x vitest run test/scripts",
      "bun x vitest run lease",
      "bunx vitest watch packages/core",
    ];
    expect(judged(commands)).toEqual(asWritten(commands));
  });

  it("D2315: leaves a Vitest run naming only .test or .spec files alone", () => {
    expect(
      judged([
        "bun x vitest run test/scripts/orchestration/lease.test.ts",
        "npx vitest run a.spec.mts b.test.tsx --reporter verbose",
      ]),
    ).toEqual([[], []]);
  });

  it("D2316: leaves a Vitest run naming an existing file alone", () => {
    const fixture = "test/fixtures/case.ts";
    expect(
      judged([`bun x vitest run ${fixture}`], {
        isFile: (target) => target === fixture,
      }),
    ).toEqual([[]]);
  });

  it("D2317: judges a Vitest run with no target heavy", () => {
    const commands = ["bun x vitest --run", "bun x vitest run -t lease"];
    expect(judged(commands)).toEqual(asWritten(commands));
  });

  it("D2337: judges vitest related over an existing source file heavy", () => {
    const command =
      "bun x vitest related scripts/lib/orchestration/lease.mjs --run";
    expect(judged([command], { isFile: () => true })).toEqual([[command]]);
  });

  it("D2318: leaves vitest list, bench and init alone", () => {
    expect(
      judged(["bun x vitest list", "bun x vitest bench", "bun x vitest init"]),
    ).toEqual([[], [], []]);
  });
});

describe("wrapped and prefixed commands", () => {
  it("D2321: judges a heavy script inside bash -c or sh -c heavy", () => {
    const commands = [
      'bash -c "bun run check"',
      "sh -c 'bun run test:defects'",
      'bash -lc "cd x && bun run check"',
    ];
    expect(judged(commands)).toEqual(asWritten(commands));
  });

  it("D2322: judges a heavy script inside pwsh -Command or powershell -c heavy", () => {
    const commands = [
      'pwsh -Command "bun run check"',
      "powershell -c bun run test:defects",
    ];
    expect(judged(commands)).toEqual(asWritten(commands));
  });

  it("D2323: judges a heavy command run through wsl heavy", () => {
    const commands = [
      'wsl.exe -e bash -lc "bun run check"',
      "wsl -d Ubuntu -- bun run check",
    ];
    expect(judged(commands)).toEqual(asWritten(commands));
  });

  it("D2324: judges a heavy command inside cmd /c heavy", () => {
    const commands = [
      "cmd /c bun run check",
      'cmd.exe /C "bun run test:defects"',
    ];
    expect(judged(commands)).toEqual(asWritten(commands));
  });

  it("D2325: judges a heavy command behind env, time, timeout, nice, xargs, exec or nohup heavy", () => {
    const commands = [
      "env CI=1 bun run check",
      "time bun run check",
      "timeout 600 bun run check",
      "timeout -s KILL 600 bun run check",
      "nice -n 5 bun run check",
      "xargs -n 1 bun run check",
      "exec bun run check",
      "nohup bun run check",
      "sudo -u me bun run check",
    ];
    expect(judged(commands)).toEqual(asWritten(commands));
  });

  it("D2326: judges a heavy command behind a shell keyword or a variable assignment heavy", () => {
    expect(
      judged([
        "if true; then bun run check; fi",
        "while true; do bun run check; done",
        "! bun run check",
        "CI=1 bun run check",
        "if false; then :; elif bun run check; then :; fi",
      ]),
    ).toEqual([
      ["then bun run check"],
      ["do bun run check"],
      ["! bun run check"],
      ["CI=1 bun run check"],
      ["elif bun run check"],
    ]);
  });
});

describe("text that runs nothing", () => {
  it("D2327: skips a Bash comment", () => {
    expect(judged(["echo ok # later; bun run check"])).toEqual([[]]);
  });

  it("D2328: skips a PowerShell block comment", () => {
    expect(
      judged(["<#\nbun run check\n#>\necho ok"], { shell: SHELL.POWERSHELL }),
    ).toEqual([[]]);
  });

  it("D2329: skips a heredoc body", () => {
    expect(judged(["cat <<'EOF'\nbun run check\nEOF\necho ok"])).toEqual([[]]);
  });

  it("D2330: skips a PowerShell here-string body", () => {
    expect(
      judged(["$x = @'\nit's\nbun run check\n'@\necho ok"], {
        shell: SHELL.POWERSHELL,
      }),
    ).toEqual([[]]);
  });

  it("D2331: skips a command substitution inside double quotes", () => {
    expect(
      judged([
        'git commit -m "$(cat <<\'EOF\'\nsay "hi\nbun run check\nEOF\n)"',
      ]),
    ).toEqual([[]]);
  });

  it("D2332: does not read a <<< here-string as a heredoc", () => {
    expect(judged(["cat <<<EOF\nbun run check\nEOF"])).toEqual([
      ["bun run check"],
    ]);
  });

  it("D2333: does not read a shift inside $((...)) as a heredoc", () => {
    expect(judged(["echo $((1 <<b))\nbun run check\nb"])).toEqual([
      ["bun run check"],
    ]);
  });

  it("D2334: escapes with a backslash in Bash and a backtick in PowerShell", () => {
    const seen = [
      ...judged(["echo a\\;bun run check"]),
      ...judged(["echo a`;bun run check", "echo a\\; bun run check"], {
        shell: SHELL.POWERSHELL,
      }),
    ];
    expect(seen).toEqual([[], [], ["bun run check"]]);
  });
});

describe("heavy run denial", () => {
  it("D2335: names the live holder before the queue sentence", () => {
    const reason = withTemp((tmp) => {
      const dir = join(tmp, "lease");
      writeLease(dir, { ...owner("t-b", HOLDER_PID), at: NOW });
      return heavyRunDenial(dir, "bun run check", {
        now: NOW,
        running: alive(HOLDER_PID),
      });
    });
    expect(reason).toBe(
      `held by t-b (th-t-b); wait for release or ask the orchestrator; do not retry. ${QUEUE_SENTENCE}`,
    );
  });

  it("D2336: gives only the queue sentence when the lease's holder is gone", () => {
    const reason = withTemp((tmp) => {
      const dir = join(tmp, "lease");
      writeLease(dir, { ...owner("t-b", HOLDER_PID), at: NOW });
      return heavyRunDenial(dir, "bun run check", {
        now: NOW,
        running: alive(),
      });
    });
    expect(reason).toBe(QUEUE_SENTENCE);
  });
});

describe("commands hidden inside other text", () => {
  it("D2342: judges a command substitution's body, quoted or in backticks", () => {
    expect(
      judged([
        'out="$(bun run check 2>&1)"',
        "out=`bun run check`",
        'echo "`bun run check`"',
      ]),
    ).toEqual([["bun run check 2>&1"], ["bun run check"], ["bun run check"]]);
  });

  it("D2343: finds a script name with a redirect glued to it", () => {
    const commands = ["bun run check>out.txt"];
    expect(judged(commands)).toEqual(asWritten(commands));
  });

  it("D2344: reads PowerShell's *> as a redirect, not a Vitest target", () => {
    expect(
      judged(
        [
          "bun x vitest run a.test.ts *> log.txt",
          "bun x vitest run a.test.ts *>log.txt",
        ],
        { shell: SHELL.POWERSHELL },
      ),
    ).toEqual([[], []]);
  });

  it("D2345: judges the command a PowerShell assignment runs, spaced", () => {
    const commands = ["$out = bun run check", "$n += bun run check"];
    expect(judged(commands, { shell: SHELL.POWERSHELL })).toEqual(
      asWritten(commands),
    );
  });

  it("D2347: judges the command a PowerShell assignment runs, joined to its variable", () => {
    const commands = ["$r=bun run check"];
    expect(judged(commands, { shell: SHELL.POWERSHELL })).toEqual(
      asWritten(commands),
    );
  });

  it("D2352: judges a command after a here-string's closing '@ on the same line", () => {
    expect(
      judged(["$m = @'\nx\n'@; bun run check"], { shell: SHELL.POWERSHELL }),
    ).toEqual([["bun run check"]]);
  });

  it("D2353: does not read a shift by a number inside (( )) as a heredoc", () => {
    expect(judged(["(( n = 1 << 2 ))\nbun run check"])).toEqual([
      ["bun run check"],
    ]);
  });

  it("D2354: judges the command eval runs", () => {
    const commands = ["eval bun run check", 'eval "bun run check"'];
    expect(judged(commands)).toEqual(asWritten(commands));
  });

  it("D2355: judges the command iex or Invoke-Expression runs", () => {
    const commands = [
      "iex 'bun run check'",
      "Invoke-Expression 'bun run test:defects'",
    ];
    expect(judged(commands, { shell: SHELL.POWERSHELL })).toEqual(
      asWritten(commands),
    );
  });

  it("D2356: splits a command line at a pipe and at parentheses", () => {
    expect(judged(["(bun run check)", "echo x | bun run check"])).toEqual([
      ["bun run check"],
      ["bun run check"],
    ]);
  });

  it("D2357: splits a command line at a brace group", () => {
    expect(judged(["{ bun run check; }"])).toEqual([["bun run check"]]);
  });

  it("D2358: finds the program behind a redirect written before it", () => {
    const commands = [">log bun run check", "2> err.txt bun run check"];
    expect(judged(commands)).toEqual(asWritten(commands));
  });
});

describe("script and runner spellings", () => {
  it("D2348: judges the defect verifier run as a file by bun heavy", () => {
    const commands = [
      "bun scripts/verify-defects.mjs",
      "bun run scripts/verify-defects.mjs",
    ];
    expect(judged(commands)).toEqual(asWritten(commands));
  });

  it("D2349: judges a heavy script run through node --run heavy", () => {
    const commands = ["node --run check", "node --run=test:defects"];
    expect(judged(commands)).toEqual(asWritten(commands));
  });

  it("D2350: keeps a directory target behind an unlisted Vitest option", () => {
    const commands = [
      "bun x vitest run --typecheck packages/core test/a.test.ts",
    ];
    expect(judged(commands)).toEqual(asWritten(commands));
  });

  it("D2351: counts only a named test file as scoped: no glob, a stem, an optional :line", () => {
    expect(
      judged([
        "bun x vitest run test/scripts/*.test.ts",
        "bun x vitest run .test.ts",
        "bun x vitest run a.test.ts:42",
      ]),
    ).toEqual([
      ["bun x vitest run test/scripts/*.test.ts"],
      ["bun x vitest run .test.ts"],
      [],
    ]);
  });

  it("D2359: finds vitest behind a runner's own options", () => {
    const commands = ["bunx --bun vitest", "npx -y vitest run"];
    expect(judged(commands)).toEqual(asWritten(commands));
  });
});
