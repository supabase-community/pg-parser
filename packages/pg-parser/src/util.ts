import type {
  PgDeparseResult,
  PgParseResult,
  SupportedVersion,
} from './types.js';

export async function unwrapParseResult<T extends SupportedVersion>(
  result: PgParseResult<T> | Promise<PgParseResult<T>>
) {
  let resolved = await result;
  if (resolved.error) {
    throw resolved.error;
  }
  return resolved.tree;
}

export async function unwrapDeparseResult(
  result: PgDeparseResult | Promise<PgDeparseResult>
) {
  let resolved = await result;
  if (resolved.error) {
    throw resolved.error;
  }
  return resolved.sql;
}
