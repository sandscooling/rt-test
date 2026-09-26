it("finished first", () => {});
it.skip("declared skip", () => {});
it("kills its worker", () => {
  process.kill(process.pid, "SIGKILL");
});
