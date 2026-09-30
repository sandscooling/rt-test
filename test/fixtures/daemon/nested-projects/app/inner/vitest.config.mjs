export default {
  test: {
    name: "inner",
    projects: [{ test: { name: "deep", include: ["deep/*.test.mjs"] } }],
  },
};
