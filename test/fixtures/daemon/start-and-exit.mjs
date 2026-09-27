import { pathToFileURL } from "node:url";

// Starts a daemon as a CLI would, prints what startDaemon resolved with, and then has nothing left to do.
const [client, options] = process.argv.slice(2);
const { startDaemon } = await import(pathToFileURL(client).href);
const identity = await startDaemon(JSON.parse(options));
process.stdout.write(JSON.stringify(identity));
