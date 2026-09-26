export type FenceKind = "prose" | "marker" | "code";

export declare function fenceKinds(lines: readonly string[]): FenceKind[];
