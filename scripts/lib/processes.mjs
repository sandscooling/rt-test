const PROBE_SIGNAL = 0;
const NO_SUCH_PROCESS = "ESRCH";

/**
 * Whether a process with this id may still run. Only "no such process" answers no, so a process this user may not
 * signal counts as running. A non-positive id is never a process, since signalling one reaches a process group.
 */
export function isRunning(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, PROBE_SIGNAL);
    return true;
  } catch (error) {
    return error.code !== NO_SUCH_PROCESS;
  }
}
