// The test names a Vitest version, and "absent" or a JSON value for the container record, that the resolved Vitest
// then presents in place of its own, standing in for a Vitest 5 minor that is not installed. Unset, it changes nothing.
const VERSION_KEY = "RT_FIXTURE_VITEST_VERSION";
const RECORD_KEY = "RT_FIXTURE_CONTAINER_RECORD";
const RECORD = "_containerConfigFiles";
const ABSENT = "absent";

export const presentVitest = {
  name: "rt-test-present-vitest",
  configureVitest({ vitest }) {
    const version = process.env[VERSION_KEY];
    if (version !== undefined) vitest.version = version;
    const record = process.env[RECORD_KEY];
    if (record === ABSENT) delete vitest.config[RECORD];
    else if (record !== undefined) vitest.config[RECORD] = JSON.parse(record);
  },
};
