import { isAbsolute, relative, sep } from "node:path";

export function isInside(parent, child) {
  const path = relative(parent, child);
  return (
    path !== "" &&
    path !== ".." &&
    !path.startsWith(`..${sep}`) &&
    !isAbsolute(path)
  );
}

export const isAtOrInside = (parent, child) =>
  relative(parent, child) === "" || isInside(parent, child);

// Every backslash, whatever the host, so the same input yields the same path on Windows and Linux.
export const toPosix = (path) => path.replaceAll("\\", "/");
