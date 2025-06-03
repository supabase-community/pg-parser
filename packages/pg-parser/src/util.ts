import { SUPPORTED_VERSIONS } from './constants.js';
import type {
  ParseResult,
  SupportedVersion,
  WrappedParseResult,
} from './types/index.js';

/**
 * Unwraps a `WrappedParseResult` by throwing an error if the result
 * contains an `error`, or otherwise returning the parsed `tree`.
 *
 * Supports both synchronous and asynchronous results.
 */
export async function unwrapParseResult<Version extends SupportedVersion>(
  result: WrappedParseResult<Version> | Promise<WrappedParseResult<Version>>
) {
  const resolved = await result;
  if (resolved.error) {
    throw resolved.error;
  }
  return resolved.tree;
}

/**
 * Gets a list of supported Postgres versions.
 */
export function getSupportedVersions() {
  return SUPPORTED_VERSIONS;
}

/**
 * Type guard to check if the major Postgres version is supported.
 */
export function isSupportedVersion(
  version: number
): version is SupportedVersion {
  return SUPPORTED_VERSIONS.includes(version as SupportedVersion);
}

/**
 * Type guard to check if the `ParseResult` is of a specific version.
 */
export function isParseResultVersion<Version extends SupportedVersion>(
  result: ParseResult<SupportedVersion>,
  version: Version
): result is ParseResult<Version> {
  if (!result.version) {
    return false;
  }

  // `result.version` looks like 170004
  const versionString = result.version.toString();

  try {
    // Strip away the last 4 digits
    const majorVersion = parseInt(versionString.slice(0, -4), 10);

    // Compare the major version with the provided version
    return majorVersion === version;
  } catch (error) {
    return false;
  }
}
