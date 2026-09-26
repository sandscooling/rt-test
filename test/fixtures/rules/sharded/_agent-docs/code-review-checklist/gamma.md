# Gamma

## Processes

C9. **Argument arrays**: A child process receives an argument array, never a shell string.

C10. **Exit status**: A wrapper preserves the runner's exit status.

## Local state

C11. **Local only**: State stays under the configured state directory.

C12. **No telemetry**: Nothing uploads results or source. → lint-hardening candidate (custom-plugin: flag a network client import in the daemon)
