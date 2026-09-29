/** Runs `body` while `process.platform` reads as `platform`, restoring it after. */
export async function onPlatform<T>(
  platform: NodeJS.Platform,
  body: () => Promise<T>,
): Promise<T> {
  const saved = Object.getOwnPropertyDescriptor(process, "platform");
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
  try {
    return await body();
  } finally {
    if (saved !== undefined) Object.defineProperty(process, "platform", saved);
  }
}
