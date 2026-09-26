export interface TestIdentity {
  readonly workspacePath: string;
  readonly projectName: string;
  readonly modulePath: string;
  readonly namePath: readonly string[];
  readonly occurrence: number;
}

export type TestModuleLocation = Pick<
  TestIdentity,
  "workspacePath" | "projectName" | "modulePath"
>;

export interface IdentifiedTest {
  readonly identity: TestIdentity;
  readonly isDuplicate: boolean;
}

export function identifyModuleTests(
  location: TestModuleLocation,
  namePaths: readonly (readonly string[])[],
): IdentifiedTest[] {
  const totals = countBy(namePaths.map(namePathKey));
  const seen = new Map<string, number>();
  return namePaths.map((namePath) => {
    const key = namePathKey(namePath);
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return {
      identity: { ...location, namePath: [...namePath], occurrence },
      isDuplicate: (totals.get(key) ?? 0) > 1,
    };
  });
}

// JSON keeps ["a b", "c"] and ["a", "b c"] apart, which a joined string would not.
function namePathKey(namePath: readonly string[]): string {
  return JSON.stringify(namePath);
}

function countBy(keys: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of keys) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}
