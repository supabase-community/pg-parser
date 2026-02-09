import type { FindContext } from './types.js';
import { rawFind } from './traverse.js';

/**
 * Predicate: checks if a node contains a RangeVar with the given table name.
 * Works at any depth — checks the node and all its descendants.
 *
 * @example
 * q.find('SelectStmt', hasTable('users'))
 * q.transformAll('SelectStmt', hasTable('orders'), sq => sq.where(...))
 */
export function hasTable(name: string) {
  return (node: unknown, _ctx: FindContext): boolean => {
    // Check if the node itself is a RangeVar
    if (
      node !== null &&
      typeof node === 'object' &&
      'relname' in node &&
      (node as { relname?: string }).relname === name
    ) {
      return true;
    }

    // Search descendants for a RangeVar with the matching relname
    const found = rawFind<{ relname?: string }>(node, 'RangeVar', (rv) => {
      return rv.relname === name;
    });

    return found.length > 0;
  };
}

/**
 * Predicate: checks if a node contains a ColumnRef matching the given column name.
 * Works at any depth.
 *
 * @example
 * q.findAll('SelectStmt', hasColumn('email'))
 */
export function hasColumn(name: string) {
  const matchFields = (fields: unknown[]): boolean =>
    fields.some(
      (f) =>
        f !== null &&
        typeof f === 'object' &&
        'String' in f &&
        (f as { String: { sval?: string } }).String.sval === name
    );

  return (node: unknown, _ctx: FindContext): boolean => {
    // Check if the node itself is a ColumnRef (when used as predicate on ColumnRef)
    if (node !== null && typeof node === 'object') {
      const cr = node as { fields?: unknown[] };
      if (cr.fields && matchFields(cr.fields)) return true;
    }

    // Search descendants for a ColumnRef with the matching column name
    const found = rawFind<{ fields?: unknown[] }>(node, 'ColumnRef', (cr) => {
      if (!cr.fields) return false;
      return matchFields(cr.fields);
    });

    return found.length > 0;
  };
}

/**
 * Predicate: checks if a ColumnRef contains A_Star (i.e., SELECT *).
 * This is a direct predicate, not a factory function.
 *
 * @example
 * q.has('ColumnRef', hasStar)
 */
export function hasStar(node: unknown, _ctx: FindContext): boolean {
  if (node === null || typeof node !== 'object') return false;

  const cr = node as { fields?: unknown[] };
  if (!cr.fields) return false;

  return cr.fields.some(
    (f) => f !== null && typeof f === 'object' && 'A_Star' in f
  );
}

/**
 * Predicate factory: checks if the node is found within a specific
 * parent context (e.g., inside a whereClause, targetList, etc.).
 *
 * @example
 * q.findAll('ColumnRef', inContext('whereClause'))
 * q.findAll('ColumnRef', inContext('targetList'))
 */
export function inContext(key: string) {
  return (_node: unknown, ctx: FindContext): boolean => {
    return ctx.path.includes(key);
  };
}
