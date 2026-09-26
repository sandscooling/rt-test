const GIT_VARIABLE_PREFIX = "GIT_";

// Git exports GIT_DIR, GIT_WORK_TREE and GIT_INDEX_FILE into a hook's environment, and
// a fixture command that inherits them acts on the outer repository instead of its own.
export function clearGitEnvironment(env: NodeJS.ProcessEnv): void {
  for (const name of Object.keys(env)) {
    if (name.toUpperCase().startsWith(GIT_VARIABLE_PREFIX)) delete env[name];
  }
}

clearGitEnvironment(process.env);
