import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { exitText } from "../vitest/error-text.js";
import { systemToolPath, TOOL_TIMEOUT_MS } from "./windows-system-tool.js";

const POWERSHELL = ["WindowsPowerShell", "v1.0", "powershell.exe"] as const;
const ENCODED_COMMAND_ENCODING = "utf16le";
const READY = "ready";
/** Written, with PowerShell's reason, when a policy such as Constrained Language Mode blocks `Add-Type`. */
const CANNOT_COMPILE = "cannot-compile";
const OK = "ok";
const ASSIGN = "assign";
const END = "end";
const WORD_SEPARATOR = " ";
const TRAILING_PERIOD = /\.$/;

/**
 * The helper holds one job object per executor: kill-on-close, and with no breakaway allowed, so every process the
 * executor's tree starts joins it, through `cmd.exe` or any other program as much as through Node. The helper is the
 * only holder of each job's handle, and it dies with the daemon, so a job's tree dies with either.
 */
const HELPER_SCRIPT = `
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
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
    Extended info = new Extended();
    info.BasicLimits.LimitFlags = KillOnJobClose;
    if (!SetInformationJobObject(job, ExtendedLimitInformation, ref info, (uint)Marshal.SizeOf(typeof(Extended)))) {
      int error = Marshal.GetLastWin32Error();
      CloseHandle(job);
      throw new Exception("SetInformationJobObject failed with " + error);
    }
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
  public static void End(long job) {
    bool ended = TerminateJobObject(new IntPtr(job), 1);
    int endError = Marshal.GetLastWin32Error();
    CloseHandle(new IntPtr(job));
    if (!ended) throw new Exception("TerminateJobObject failed with " + endError);
  }
}
'@
} catch { Write-Output ('${CANNOT_COMPILE}${WORD_SEPARATOR}' + $_.Exception.Message); exit 1 }
[Console]::Out.WriteLine('${READY}')
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $words = $line.Split('${WORD_SEPARATOR}')
  try {
    if ($words[0] -eq '${ASSIGN}') { [Console]::Out.WriteLine('${OK} ' + [RtTestJob]::Assign([uint32]$words[1])) }
    elseif ($words[0] -eq '${END}') { [RtTestJob]::End([int64]$words[1]); [Console]::Out.WriteLine('${OK}') }
    else { [Console]::Out.WriteLine('unknown command ' + $words[0]) }
  } catch { [Console]::Out.WriteLine($_.Exception.Message) }
  [Console]::Out.Flush()
}
`;

/** A process tree held in a job object; ending it ends every process in the tree at once. */
export interface JobTree {
  end(): Promise<void>;
}

/** Puts each executor in a job object of its own, through one helper process started at the first job. */
export class WindowsJobs {
  #helper: JobHelper | undefined;

  async contain(pid: number): Promise<JobTree> {
    const helper = await this.#running();
    const job = await helper.ask(`${ASSIGN}${WORD_SEPARATOR}${pid}`);
    return {
      end: async () => void (await helper.ask(`${END}${WORD_SEPARATOR}${job}`)),
    };
  }

  /** Ends the helper, which ends every job it still holds. */
  async close(): Promise<void> {
    await this.#helper?.close();
    this.#helper = undefined;
  }

  async #running(): Promise<JobHelper> {
    if (this.#helper?.alive !== true) this.#helper = await JobHelper.start();
    return this.#helper;
  }
}

class JobHelper {
  readonly #process: ChildProcess;
  readonly #waiting: ((line: string | Error) => void)[] = [];
  #ended: Error | undefined;

  private constructor(child: ChildProcess) {
    this.#process = child;
    createInterface({ input: child.stdout! }).on("line", (line) =>
      this.#waiting.shift()?.(line),
    );
    child.once("error", (error) => this.#end(error));
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
    const prefix = `${CANNOT_COMPILE}${WORD_SEPARATOR}`;
    if (!ready.startsWith(prefix)) {
      throw new Error(`the job object helper did not start: ${ready}`);
    }
    throw new Error(
      `Windows PowerShell refused to compile the job object helper that ends each job's processes, so no job can run (${ready.slice(prefix.length).trim().replace(TRAILING_PERIOD, "")}). A policy that restricts PowerShell, such as Constrained Language Mode, AppLocker or Windows Defender Application Control, blocks Add-Type; ask an administrator to allow Add-Type in ${systemToolPath(...POWERSHELL)} for this user, then stop the daemon and start it again`,
    );
  }

  get alive(): boolean {
    return this.#ended === undefined;
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
      const timer = setTimeout(() => this.#process.kill(), TOOL_TIMEOUT_MS);
      this.#process.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      this.#process.stdin!.end();
    });
  }

  #next(): Promise<string> {
    if (this.#ended !== undefined) return Promise.reject(this.#ended);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#process.kill();
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

  #end(error: Error): void {
    this.#ended ??= error;
    for (const wake of this.#waiting.splice(0)) wake(error);
  }
}
