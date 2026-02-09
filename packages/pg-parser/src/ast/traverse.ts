import type { Node } from '../../wasm/17/pg-parser-types.js';
import type { FindContext, NodeTypeName, Predicate } from './types.js';

type FoundNode<T> = {
  typeName: string;
  node: T;
  wrapped: Node;
  ctx: FindContext;
};

/**
 * Checks if a value looks like a wrapped Node (single-key object
 * where the key is a capitalized type name).
 */
function isWrappedNode(value: unknown): value is Node {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  if (keys.length !== 1) return false;
  // Node type names are PascalCase and start with uppercase
  return /^[A-Z]/.test(keys[0]!);
}

/**
 * Depth-first walk of an AST tree. Finds all nodes matching a type name
 * and optional predicate.
 *
 * @internal Not part of the public API.
 */
export function rawFind<T>(
  root: unknown,
  nodeType: NodeTypeName,
  predicate?: Predicate<T>
): FoundNode<T>[] {
  const results: FoundNode<T>[] = [];

  function walk(
    value: unknown,
    parentKey: string,
    parent: unknown,
    index: number | undefined,
    path: string[]
  ): void {
    if (value === null || value === undefined || typeof value !== 'object') {
      return;
    }

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        walk(value[i], parentKey, value, i, [...path, String(i)]);
      }
      return;
    }

    // Check if this is a wrapped node
    const keys = Object.keys(value);
    if (keys.length === 1 && /^[A-Z]/.test(keys[0]!)) {
      const typeName = keys[0]!;
      const innerNode = (value as Record<string, unknown>)[typeName];

      if (typeName === nodeType) {
        const ctx: FindContext = {
          index,
          parent,
          parentKey,
          path: [...path, typeName],
        };

        if (!predicate || predicate(innerNode as T, ctx)) {
          results.push({
            typeName,
            node: innerNode as T,
            wrapped: value as Node,
            ctx,
          });
        }
      }

      // Recurse into the inner node's fields
      if (innerNode !== null && typeof innerNode === 'object') {
        const innerPath = [...path, typeName];
        for (const [key, child] of Object.entries(
          innerNode as Record<string, unknown>
        )) {
          walk(child, key, innerNode, undefined, [...innerPath, key]);
        }
      }
      return;
    }

    // Plain object — recurse into its fields
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>
    )) {
      walk(child, key, value, undefined, [...path, key]);
    }
  }

  // Start the walk
  if (root !== null && typeof root === 'object') {
    if (isWrappedNode(root)) {
      // Root is a wrapped node — walk it directly
      walk(root, '', null, undefined, []);
    } else {
      // Root is an unwrapped object (e.g., ParseResult) — walk its fields
      for (const [key, child] of Object.entries(
        root as Record<string, unknown>
      )) {
        walk(child, key, root, undefined, [key]);
      }
    }
  }

  return results;
}

/**
 * Immutable deep transform of an AST tree. Finds nodes matching a type name
 * and replaces them using a transform function.
 *
 * Returns a deep clone with matched nodes replaced. Non-matched nodes
 * are structurally shared (no unnecessary cloning).
 *
 * @param root - The root AST object
 * @param nodeType - The node type name to match
 * @param fn - Transform function receiving (wrappedNode, unwrappedNode, ctx) → new wrapped Node
 * @param matchFirst - If true, only transforms the first match
 *
 * @internal Not part of the public API.
 */
export function rawTransform(
  root: unknown,
  nodeType: NodeTypeName,
  fn: (wrapped: Node, inner: unknown, ctx: FindContext) => Node,
  predicate?: Predicate<unknown>,
  matchFirst = false
): unknown {
  let matched = false;

  function walk(
    value: unknown,
    parentKey: string,
    parent: unknown,
    index: number | undefined,
    path: string[]
  ): unknown {
    if (value === null || value === undefined || typeof value !== 'object') {
      return value;
    }

    if (Array.isArray(value)) {
      let changed = false;
      const result = value.map((item, i) => {
        const transformed = walk(item, parentKey, value, i, [
          ...path,
          String(i),
        ]);
        if (transformed !== item) changed = true;
        return transformed;
      });
      return changed ? result : value;
    }

    const keys = Object.keys(value);

    // Wrapped node check
    if (keys.length === 1 && /^[A-Z]/.test(keys[0]!)) {
      const typeName = keys[0]!;
      const innerNode = (value as Record<string, unknown>)[typeName];

      if (typeName === nodeType && !(matchFirst && matched)) {
        const ctx: FindContext = {
          index,
          parent,
          parentKey,
          path: [...path, typeName],
        };

        if (!predicate || predicate(innerNode, ctx)) {
          matched = true;
          const replacement = fn(value as Node, innerNode, ctx);

          // Recurse into the replacement too (it may contain deeper matches)
          if (!matchFirst || matched) {
            return replacement;
          }
          return replacement;
        }
      }

      // Recurse into inner node
      if (innerNode !== null && typeof innerNode === 'object') {
        const innerPath: string[] = [...path, typeName];
        const transformedInner = walkObject(
          innerNode as Record<string, unknown>,
          innerPath
        );
        if (transformedInner !== innerNode) {
          return { [typeName as string]: transformedInner };
        }
      }

      return value;
    }

    // Plain object
    return walkObject(value as Record<string, unknown>, path);
  }

  function walkObject(
    obj: Record<string, unknown>,
    path: string[]
  ): Record<string, unknown> {
    let changed = false;
    const result: Record<string, unknown> = {};

    for (const [key, child] of Object.entries(obj)) {
      const transformed = walk(child, key, obj, undefined, [
        ...path,
        key,
      ]);
      result[key] = transformed;
      if (transformed !== child) changed = true;
    }

    return changed ? result : obj;
  }

  // Start
  if (root !== null && typeof root === 'object') {
    if (isWrappedNode(root)) {
      return walk(root, '', null, undefined, []);
    }
    return walkObject(root as Record<string, unknown>, []);
  }

  return root;
}

/**
 * Walk the tree and call a visitor for each node of matching types.
 *
 * @internal Not part of the public API.
 */
export function rawVisit(
  root: unknown,
  visitors: Record<string, (node: unknown, ctx: FindContext) => void>
): void {
  function walk(
    value: unknown,
    parentKey: string,
    parent: unknown,
    index: number | undefined,
    path: string[]
  ): void {
    if (value === null || value === undefined || typeof value !== 'object') {
      return;
    }

    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        walk(value[i], parentKey, value, i, [...path, String(i)]);
      }
      return;
    }

    const keys = Object.keys(value);

    if (keys.length === 1 && /^[A-Z]/.test(keys[0]!)) {
      const typeName = keys[0]!;
      const innerNode = (value as Record<string, unknown>)[typeName];

      const visitor = visitors[typeName];
      if (visitor) {
        const ctx: FindContext = {
          index,
          parent,
          parentKey,
          path: [...path, typeName],
        };
        visitor(innerNode, ctx);
      }

      // Recurse into inner node
      if (innerNode !== null && typeof innerNode === 'object') {
        const innerPath = [...path, typeName];
        for (const [key, child] of Object.entries(
          innerNode as Record<string, unknown>
        )) {
          walk(child, key, innerNode, undefined, [...innerPath, key]);
        }
      }
      return;
    }

    // Plain object
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>
    )) {
      walk(child, key, value, undefined, [...path, key]);
    }
  }

  if (root !== null && typeof root === 'object') {
    if (isWrappedNode(root)) {
      walk(root, '', null, undefined, []);
    } else {
      for (const [key, child] of Object.entries(
        root as Record<string, unknown>
      )) {
        walk(child, key, root, undefined, [key]);
      }
    }
  }
}
