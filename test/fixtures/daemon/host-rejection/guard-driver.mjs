// Drives the executor's host rejection guard in a process of its own, installed as the executor installs it. Its
// arguments are the guard module's URL and a scenario: `outside` raises a rejection while no session records, then
// writes `survived`; `after-close` opens and closes a session, then raises one; `at-end` raises one as a session's body
// returns; `record <count>` raises that many in one session and waits a macrotask before the body returns. A session's
// recorded rejections are written to stdout as JSON.
const [guardModule, scenario, count] = process.argv.slice(2);
const { guardHostRejections, recordingHostRejections } = await import(
  guardModule
);

function raise(what) {
  void Promise.reject(new Error(what));
}

const nextMacrotask = () => new Promise((resolve) => setImmediate(resolve));

guardHostRejections();
if (scenario === "outside") {
  raise("host rejection while no session was open");
  await nextMacrotask();
  process.stdout.write("survived\n");
} else if (scenario === "after-close") {
  await recordingHostRejections(async () => undefined);
  raise("host rejection after the session closed");
  await nextMacrotask();
} else if (scenario === "at-end") {
  const { rejections } = await recordingHostRejections(async () => {
    raise("host rejection as the session's body returns");
  });
  process.stdout.write(JSON.stringify(rejections));
} else if (scenario === "record") {
  const { rejections } = await recordingHostRejections(async () => {
    for (let index = 0; index < Number(count); index += 1) {
      raise(`host rejection ${index}`);
    }
    await nextMacrotask();
  });
  process.stdout.write(JSON.stringify(rejections));
} else {
  throw new Error(`unknown scenario ${scenario}`);
}
