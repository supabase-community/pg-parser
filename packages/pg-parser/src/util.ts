import type { PgParseResult } from './types.js';

export async function unwrapResult(
  result: PgParseResult | Promise<PgParseResult>
) {
  let resolved = await result;
  if (resolved.error) {
    throw resolved.error;
  }
  return resolved.tree;
}
