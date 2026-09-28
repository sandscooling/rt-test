import net from "node:net";
import { syncBuiltinESMExports } from "node:module";

// Preloaded into a heartbeat child a test starts, it resets the child's connection the first time the test writes to
// it, as a connection the OS reset would, so the child meets an error on its socket rather than a clean end.
const RESET_CODE = "ECONNRESET";
const { createConnection } = net;

net.createConnection = (...args) => {
  const socket = createConnection(...args);
  socket.once("data", () =>
    socket.destroy(
      Object.assign(new Error(`read ${RESET_CODE}`), { code: RESET_CODE }),
    ),
  );
  return socket;
};
syncBuiltinESMExports();
