// A test environment that changes nothing but the Vite environment its project's modules are served through.
export default {
  name: "client-served",
  viteEnvironment: "client",
  setup() {
    return { teardown() {} };
  },
};
