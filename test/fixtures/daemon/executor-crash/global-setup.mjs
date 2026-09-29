// RT_EXECUTOR_CRASH names how the global setup ends the executor process it runs in: `throw` throws uncaught on the
// next turn of its event loop, before any test can finish, and `exit-in-teardown` calls `process.exit(3)` from the
// teardown, once the run has ended.
const crash = process.env.RT_EXECUTOR_CRASH ?? "";
const EXIT_CODE = 3;

export default function setup() {
  if (crash === "throw") {
    setImmediate(() => {
      throw new Error("uncaught from the global setup");
    });
  }
  return () => {
    if (crash === "exit-in-teardown") process.exit(EXIT_CODE);
  };
}
