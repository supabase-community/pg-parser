import type { PgParseResult, SupportedVersion } from './types.js';

export async function unwrapResult<T extends SupportedVersion>(
  result: PgParseResult<T> | Promise<PgParseResult<T>>
) {
  let resolved = await result;
  if (resolved.error) {
    throw resolved.error;
  }
  return resolved.tree;
}
