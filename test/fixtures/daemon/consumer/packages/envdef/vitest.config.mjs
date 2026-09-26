export default {
  define: { "process.env.RT_FIXTURE_DEFINE": JSON.stringify("defined") },
  test: { globals: true, env: { RT_FIXTURE_ENV: "set" } },
};
