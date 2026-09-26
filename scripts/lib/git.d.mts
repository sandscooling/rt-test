export interface GitRun {
  readonly ok: boolean;
  readonly out: string;
}

export type Git = (args: readonly string[]) => GitRun;

export type Listing =
  | { readonly paths: string[]; readonly error?: undefined }
  | { readonly error: string; readonly paths?: undefined };

export declare function gitIn(root: string): Git;
export declare function changedPaths(git: Git): Listing;
export declare function trackedPaths(git: Git): Listing;
