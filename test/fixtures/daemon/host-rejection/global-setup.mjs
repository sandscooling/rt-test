const site = process.env.RT_HOST_REJECTION ?? "";

function leak(where) {
  void Promise.reject(new Error(`host rejection from ${where}`));
}

export default function setup() {
  if (site === "global-setup" || site === "global-setup-and-test-body")
    leak("the global setup");
  return () => {
    if (site === "teardown") leak("the global setup's teardown");
  };
}
