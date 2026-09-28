import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

// Preloaded into a heartbeat child a test starts, it ends the child's lifetime the first time the test writes to its
// connection, as if the lifetime had run out right then, so a test sees an expired child without waiting it out. The
// first timeout the child sets is its lifetime; it still runs at its own time if the test never writes.
const { setTimeout: startTimeout } = globalThis;
const { createConnection } = net;
let endLifetime;

globalThis.setTimeout = (callback, ...rest) => {
  endLifetime ??= callback;
  return startTimeout(callback, ...rest);
};

net.createConnection = (...args) => {
  const socket = createConnection(...args);
  socket.once("data", () => endLifetime?.());
  return socket;
};
syncBuiltinESMExports();
