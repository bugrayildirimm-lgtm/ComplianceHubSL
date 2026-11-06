// Module resolution hook: maps the Deno-style specifiers used by the ported functions onto
// local modules so the function files can stay byte-for-byte what Base44 ran.
const SDK = new URL('./sdk.js', import.meta.url).href;
export async function resolve(specifier, context, next) {
  if (specifier.startsWith('npm:@base44/sdk')) return { url: SDK, shortCircuit: true };
  return next(specifier, context);
}
