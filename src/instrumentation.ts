/**
 * Next.js instrumentation hook. The NEXT_RUNTIME check is statically
 * replaced at build time, so the Gmail sync module is only ever bundled
 * into the Node.js server — never the edge runtime.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
