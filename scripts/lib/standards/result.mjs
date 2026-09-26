const text = (lines) => (lines.length === 0 ? "" : `${lines.join("\n")}\n`);

export function result(code, out = [], err = []) {
  return { code, out: text(out), err: text(err) };
}

export function emit({ code, out, err }) {
  process.stdout.write(out);
  process.stderr.write(err);
  process.exitCode = code;
}
