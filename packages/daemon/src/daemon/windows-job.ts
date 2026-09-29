import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { errorText, exitText } from "../vitest/error-text.js";
import { hasExited } from "./child-exit.js";
import { systemToolPath, TOOL_TIMEOUT_MS } from "./windows-system-tool.js";

const POWERSHELL = ["WindowsPowerShell", "v1.0", "powershell.exe"] as const;
const ENCODED_COMMAND_ENCODING = "utf16le";
const READY = "ready";
/** Written, with PowerShell's reason, when a policy such as Constrained Language Mode blocks `Add-Type`. */
const BLOCKED_BY_POLICY = "blocked-by-policy";
/** Written, with PowerShell's reason, when `Add-Type` fails in a session no policy restricts. */
const CANNOT_COMPILE = "cannot-compile";
const OK = "ok";
const ASSIGN = "assign";
const HOLD = "hold";
const RELEASE = "release";
const END = "end";
const WORD_SEPARATOR = " ";
/** The exit code of each process a job's end terminates. */
const ENDED_EXIT_CODE = 1;
const CANNOT_COMPILE_EXIT_CODE = 1;
const TRAILING_PERIOD = /\.$/;
const FIRST_PRINTABLE = 0x20;
const LAST_PRINTABLE = 0x7e;
const BACKSLASH = 0x5c;
const ESCAPE_PREFIX = "\\u";
/** A character the helper wrote as `ESCAPE_PREFIX` and four lowercase hex digits. */
const ESCAPED_CHARACTER = /\\u([0-9a-f]{4})/g;
const HEX_RADIX = 16;
const HELPER_CLOSED = "the job object helper was closed";
const NEVER_STARTED = "it never started";
const EXITED_BEFORE_ASSIGN =
  "it exited before it could be put in a job object, and its process id may since name another process";
const EXITED_DURING_ASSIGN =
  "it exited while it was put in a job object, so that job was closed without ending the process it held, which may be another that took the id";

/**
 * The helper holds one job object per executor, with no breakaway allowed, so every process the executor's tree starts
 * joins it, through `cmd.exe` or any other program as much as through Node. `hold` makes a job kill on close. The
 * helper is the only holder of each job's handle, and it dies with the daemon, so a held job's tree dies with either.
 * Each answer is one ASCII line: the console writes in the OEM code page and an exception message can span lines, so
 * the helper escapes every character outside printable ASCII, and the backslash, as `ESCAPE_PREFIX` and four hex digits.
 */
const HELPER_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
function ConvertTo-Answer([string]$text) {
  -join ($text.ToCharArray() | ForEach-Object {
    $code = [int]$_
    if ($code -ge ${FIRST_PRINTABLE} -and $code -le ${LAST_PRINTABLE} -and $code -ne ${BACKSLASH}) { [string]$_ } else { '${ESCAPE_PREFIX}{0:x4}' -f $code }
  })
}
try {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RtTestJob {
  [StructLayout(LayoutKind.Sequential)] struct Basic { public long UserTime; public long JobTime; public uint LimitFlags; public UIntPtr MinimumWorkingSet; public UIntPtr MaximumWorkingSet; public uint ActiveProcessLimit; public UIntPtr Affinity; public uint PriorityClass; public uint SchedulingClass; }
  [StructLayout(LayoutKind.Sequential)] struct Io { public ulong ReadOperations, WriteOperations, OtherOperations, ReadBytes, WriteBytes, OtherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct Extended { public Basic BasicLimits; public Io IoInfo; public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed; }
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr CreateJobObject(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref Extended info, uint size);
  [DllImport("kernel32.dll", SetLastError = true)] static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateJobObject(IntPtr job, uint exitCode);
  [DllImport("kernel32.dll", SetLastError = true)] static extern bool CloseHandle(IntPtr handle);
  const int ExtendedLimitInformation = 9;
  const uint KillOnJobClose = 0x2000;
  const uint SetQuotaAndTerminate = 0x0100 | 0x0001;
  public static long Assign(uint pid) {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) throw new Exception("CreateJobObject failed with " + Marshal.GetLastWin32Error());
    IntPtr process = OpenProcess(SetQuotaAndTerminate, false, pid);
    if (process == IntPtr.Zero) {
      int error = Marshal.GetLastWin32Error();
      CloseHandle(job);
      throw new Exception("OpenProcess failed with " + error);
    }
    bool assigned = AssignProcessToJobObject(job, process);
    int assignError = Marshal.GetLastWin32Error();
    CloseHandle(process);
    if (!assigned) { CloseHandle(job); throw new Exception("AssignProcessToJobObject failed with " + assignError); }
    return job.ToInt64();
  }
  public static void Hold(long job) {
    Extended info = new Extended();
    info.BasicLimits.LimitFlags = KillOnJobClose;
    if (!SetInformationJobObject(new IntPtr(job), ExtendedLimitInformation, ref info, (uint)Marshal.SizeOf(typeof(Extended)))) {
      int error = Marshal.GetLastWin32Error();
      CloseHandle(new IntPtr(job));
      throw new Exception("SetInformationJobObject failed with " + error);
    }
  }
  public static void Release(long job) {
    CloseHandle(new IntPtr(job));
  }
  public static void End(long job) {
    bool ended = TerminateJobObject(new IntPtr(job), ${ENDED_EXIT_CODE});
    int endError = Marshal.GetLastWin32Error();
    CloseHandle(new IntPtr(job));
    if (!ended) throw new Exception("TerminateJobObject failed with " + endError);
  }
}
'@
} catch {
  $failure = if ($ExecutionContext.SessionState.LanguageMode -eq 'FullLanguage') { '${CANNOT_COMPILE}' } else { '${BLOCKED_BY_POLICY}' }
  Write-Output ($failure + '${WORD_SEPARATOR}' + (ConvertTo-Answer $_.Exception.Message)); exit ${CANNOT_COMPILE_EXIT_CODE}
}
function Write-Answer([string]$text) {
  [Console]::Out.WriteLine((ConvertTo-Answer $text))
  [Console]::Out.Flush()
}
Write-Answer '${READY}'
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $words = $line.Split('${WORD_SEPARATOR}')
  try {
    if ($words[0] -eq '${ASSIGN}') { Write-Answer ('${OK}${WORD_SEPARATOR}' + [RtTestJob]::Assign([uint32]$words[1])) }
    elseif ($words[0] -eq '${HOLD}') { [RtTestJob]::Hold([int64]$words[1]); Write-Answer '${OK}' }
    elseif ($words[0] -eq '${RELEASE}') { [RtTestJob]::Release([int64]$words[1]); Write-Answer '${OK}' }
    elseif ($words[0] -eq '${END}') { [RtTestJob]::End([int64]$words[1]); Write-Answer '${OK}' }
    else { Write-Answer ('unknown command ' + $words[0]) }
  } catch { Write-Answer $_.Exception.Message }
}
`;

/** A process tree held in a job object; ending it ends every process in the tree at once. */
export interface JobTree {
  end(): Promise<void>;
}

/** Puts each executor in a job object of its own, through one helper process started at the first job. */
export class WindowsJobs {
  #helper: JobHelper | undefined;
  #starting: Promise<JobHelper> | undefined;
  #closed = false;

  /**
   * Puts the executor in a job of its own, which ends its tree on close only once the process the helper opened by
   * its id is proven to be the executor. One that exits first is refused, since its id may by then name another.
   */
  async contain(executor: ChildProcess): Promise<JobTree> {
    const helper = await this.#running();
    if (this.#closed) throw new Error(HELPER_CLOSED);
    if (executor.pid === undefined) throw new Error(NEVER_STARTED);
    if (hasExited(executor)) throw new Error(EXITED_BEFORE_ASSIGN);
    const job = await helper.ask(`${ASSIGN}${WORD_SEPARATOR}${executor.pid}`);
    // Node closes its handle on a process only after it records the exit, and Windows reuses no id while a handle is open.
    if (hasExited(executor)) {
      throw new Error(
        `${EXITED_DURING_ASSIGN}${await releaseUnproven(helper, job)}`,
      );
    }
    await helper.ask(`${HOLD}${WORD_SEPARATOR}${job}`);
    let ended: Promise<void> | undefined;
    return {
      end: () =>
        (ended ??= helper
          .ask(`${END}${WORD_SEPARATOR}${job}`)
          .then(() => undefined)),
    };
  }

  /** Ends the helper, one still starting included, which ends every job it still holds, and starts no other. */
  async close(): Promise<void> {
    this.#closed = true;
    await this.#starting?.catch(() => undefined);
    await this.#helper?.close();
    this.#helper = undefined;
  }

  #running(): Promise<JobHelper> {
    if (this.#closed) return Promise.reject(new Error(HELPER_CLOSED));
    if (this.#helper?.alive === true) return Promise.resolve(this.#helper);
    this.#starting ??= this.#start();
    return this.#starting;
  }

  async #start(): Promise<JobHelper> {
    try {
      this.#helper = await JobHelper.start();
      return this.#helper;
    } finally {
      this.#starting = undefined;
    }
  }
}

class JobHelper {
  readonly #process: ChildProcess;
  readonly #waiting: ((line: string | Error) => void)[] = [];
  #ended: Error | undefined;

  private constructor(child: ChildProcess) {
    this.#process = child;
    createInterface({ input: child.stdout! })
      .on("line", (line) => this.#waiting.shift()?.(decodedAnswer(line)))
      .on("error", (error) => this.#end(error));
    child.on("error", (error) => this.#end(error));
    child.stdin!.on("error", (error) => this.#end(error));
    // Not `exit`: `close` follows the last line of stdout, so a reason the helper wrote before exiting is read first.
    child.once("close", (code, signal) =>
      this.#end(
        new Error(`the job object helper exited (${exitText(code, signal)})`),
      ),
    );
  }

  static async start(): Promise<JobHelper> {
    const child = spawn(
      systemToolPath(...POWERSHELL),
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(HELPER_SCRIPT, ENCODED_COMMAND_ENCODING).toString("base64"),
      ],
      { stdio: ["pipe", "pipe", "inherit"], windowsHide: true },
    );
    const helper = new JobHelper(child);
    const ready = await helper.#next();
    if (ready === READY) return helper;
    child.kill();
    throw startFailure(ready);
  }

  get alive(): boolean {
    return this.#ended === undefined && !hasExited(this.#process);
  }

  /** Sends one command and resolves with what follows its `ok`, or rejects with the helper's reason. */
  async ask(command: string): Promise<string> {
    if (this.#ended !== undefined) throw this.#ended;
    this.#process.stdin!.write(`${command}\n`);
    const answer = await this.#next();
    if (answer === OK) return "";
    if (answer.startsWith(`${OK}${WORD_SEPARATOR}`)) {
      return answer.slice(OK.length + WORD_SEPARATOR.length);
    }
    throw new Error(`the job object helper refused "${command}": ${answer}`);
  }

  close(): Promise<void> {
    if (!this.alive) return Promise.resolve();
    return new Promise((resolve) => {
      this.#process.once("close", () => resolve());
      this.#end(new Error(HELPER_CLOSED));
    });
  }

  #next(): Promise<string> {
    if (this.#ended !== undefined) return Promise.reject(this.#ended);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#end(
          new Error(
            `the job object helper did not answer within ${TOOL_TIMEOUT_MS} ms`,
          ),
        );
      }, TOOL_TIMEOUT_MS);
      this.#waiting.push((line) => {
        clearTimeout(timer);
        if (line instanceof Error) reject(line);
        else resolve(line);
      });
    });
  }

  /**
   * Ends a helper the daemon can no longer rely on, which ends every job it holds: once its answers cannot be read,
   * none of those jobs could be ended on request.
   */
  #end(error: Error): void {
    if (this.#ended !== undefined) return;
    this.#ended = error;
    this.#process.kill();
    for (const wake of this.#waiting.splice(0)) wake(error);
  }
}

/** Closes a job whose process was never proven to be the executor, which ends nothing, and returns why it could not, or nothing. */
async function releaseUnproven(
  helper: JobHelper,
  job: string,
): Promise<string> {
  try {
    await helper.ask(`${RELEASE}${WORD_SEPARATOR}${job}`);
    return "";
  } catch (error) {
    return `; closing that job failed: ${errorText(error)}`;
  }
}

function decodedAnswer(line: string): string {
  return line.replace(ESCAPED_CHARACTER, (_escape, hex: string) =>
    String.fromCharCode(Number.parseInt(hex, HEX_RADIX)),
  );
}

/** Why the helper's first line was not `ready`: a policy blocked its compile, its compile failed, or it wrote something else. */
function startFailure(line: string): Error {
  const blocked = reasonAfter(BLOCKED_BY_POLICY, line);
  if (blocked !== undefined) {
    return new Error(
      `Windows PowerShell refused to compile the job object helper that ends each job's processes, so no job can run (${blocked}). A policy that restricts PowerShell, such as Constrained Language Mode, AppLocker or Windows Defender Application Control, blocks Add-Type; ask an administrator to allow Add-Type in ${systemToolPath(...POWERSHELL)} for this user, then stop the daemon and start it again`,
    );
  }
  const failed = reasonAfter(CANNOT_COMPILE, line);
  if (failed !== undefined) {
    return new Error(
      `Windows PowerShell could not compile the job object helper that ends each job's processes, so no job can run (${failed})`,
    );
  }
  return new Error(`the job object helper did not start: ${line}`);
}

function reasonAfter(tag: string, line: string): string | undefined {
  const prefix = `${tag}${WORD_SEPARATOR}`;
  if (!line.startsWith(prefix)) return undefined;
  return line.slice(prefix.length).trim().replace(TRAILING_PERIOD, "");
}
