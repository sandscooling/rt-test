<!--
Fixture shard alpha.
-->

# Alpha

## Storage

### Writes

C1. **Atomic writes**: A write replaces the whole record in one step.

C2. **Named bounds**: A bounded read takes its limit from a named constant.
It never inlines the number.

### Reads

C3. **Fresh reads**: A read compares fingerprints before it reports current.

## Output

C4. **Versioned output**: Every JSON payload carries a schema version.
