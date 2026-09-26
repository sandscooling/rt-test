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
