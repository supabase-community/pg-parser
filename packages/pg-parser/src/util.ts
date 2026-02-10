import { SUPPORTED_VERSIONS } from './constants.js';
import type {
  Node,
  ParseResult,
  SupportedVersion,
  WrappedDeparseResult,
  WrappedParseResult,
  WrappedScanResult,
} from './types/index.js';

/**
 * Extracts keys from a union type.
 */
type ExtractKeys<T> = T extends T ? keyof T : never;

/**
 * Unwraps a Node to get its underlying value based on
 * the specified type of the node.
 */
export type NodeValue<T extends Node, U extends ExtractKeys<T>> =
  T extends Record<U, infer V> ? V : never;

/**
 * Unwraps a Node into its type and value.
 */
export type UnwrappedNode<T extends Node> =
  T extends Record<infer K, infer V> ? { type: K; node: V } : never;

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
 * Unwraps a `WrappedDeparseResult` by throwing an error if the result
 * contains an `error`, or otherwise returning the deparsed SQL string.
 *
 * Supports both synchronous and asynchronous results.
 */
export async function unwrapDeparseResult(
  result: WrappedDeparseResult | Promise<WrappedDeparseResult>
) {
  const resolved = await result;
  if (resolved.error) {
    throw resolved.error;
  }
  return resolved.sql;
}

/**
 * Unwraps a `WrappedScanResult` by throwing an error if the result
 * contains an `error`, or otherwise returning the scanned tokens.
 *
 * Supports both synchronous and asynchronous results.
 */
export async function unwrapScanResult(
  result: WrappedScanResult | Promise<WrappedScanResult>
) {
  const resolved = await result;
  if (resolved.error) {
    throw resolved.error;
  }
  return resolved.tokens;
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
  result: ParseResult,
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

/**
 * Asserts that a value is defined.
 *
 * Useful for type narrowing.
 */
export function assertDefined<T>(
  value: T | undefined,
  errorMessage: string
): asserts value is T {
  if (value === undefined) {
    throw new Error(errorMessage);
  }
}

/**
 * Unwraps a `Node` to get its type and underlying value.
 *
 * Unwrapping makes it easier to work with nodes
 * by allowing you to narrow them based on their type.
 *
 * @example
 * const tree = await unwrapParseResult(parser.parse('SELECT 1'));
 * const firstStmt = tree.stmts.[0].stmt;
 * const { type, node } = unwrapNode(firstStmt);
 *
 * switch (type) {
 *  case 'SelectStmt':
 *    // Now `node` is narrowed to `SelectStmt`
 *    break;
 * }
 */
export function unwrapNode<T extends Node>(wrappedNode: T) {
  const keys = Object.keys(wrappedNode) as ExtractKeys<T>[];

  if (keys.length === 0) {
    throw new Error('node has no keys, expected a single key');
  }

  if (keys.length > 1) {
    throw new Error(
      `node has multiple keys, expected a single key: ${keys.join(', ')}`
    );
  }

  const [type] = keys;

  if (!type) {
    throw new Error('node has no keys, expected a single key');
  }

  const node = wrappedNode[type];

  return { type, node } as UnwrappedNode<T>;
}

/**
 * Asserts that a `Node` is a specific type and
 * unwraps its underlying value.
 *
 * @returns The unwrapped `Node` value.
 * @throws If `node` is not of type `type`.
 */
export function assertAndUnwrapNode<T extends Node, U extends ExtractKeys<T>>(
  wrappedNode: T,
  expectedType: U,
  errorMessage?: string
): NodeValue<T, U> {
  const { type, node } = unwrapNode(wrappedNode);

  if (type !== expectedType) {
    throw new Error(
      errorMessage ?? `expected node of type ${expectedType}, got ${type}`
    );
  }

  return node as NodeValue<T, U>;
}
