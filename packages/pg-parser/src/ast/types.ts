import type {
  Node,
  ParseResult,
  SelectStmt,
  InsertStmt,
  UpdateStmt,
  DeleteStmt,
  CreateStmt,
  AlterTableStmt,
  IndexStmt,
} from '../../wasm/17/pg-parser-types.js';

/**
 * Extract keys from a union type.
 */
type ExtractKeys<T> = T extends T ? keyof T : never;

/**
 * All possible node type names in the PG AST.
 */
export type NodeTypeName = ExtractKeys<Node>;

/**
 * Map a node type name to its unwrapped interface.
 *
 * @example
 * NodeOfType<'SelectStmt'> → SelectStmt
 * NodeOfType<'ColumnRef'> → ColumnRef
 */
export type NodeOfType<T extends NodeTypeName> = Extract<
  Node,
  Record<T, unknown>
>[T];

/**
 * Auto-coercion input type for expression helpers.
 *
 * - `string` → `col()` (left position) or `val()` (right position)
 * - `number` → `val()`
 * - `boolean` → `val()`
 * - `null` → `val(null)`
 * - `Node` → passthrough
 */
export type ExprArg = string | number | boolean | null | Node;

/**
 * Context passed to traversal predicates.
 */
export type FindContext = {
  /** Position in parent array (undefined if not in array) */
  index?: number;
  /** The parent object containing this node */
  parent: unknown;
  /** Key on parent ('targetList', 'whereClause', etc.) */
  parentKey: string;
  /** Full ancestry path from root */
  path: string[];
};

/**
 * Predicate function for find/findAll/transform/transformAll/has.
 */
export type Predicate<T> = (node: T, ctx: FindContext) => boolean;

/**
 * Known statement type names that map to specific builder classes.
 */
export type KnownStmtType =
  | 'SelectStmt'
  | 'InsertStmt'
  | 'UpdateStmt'
  | 'DeleteStmt'
  | 'CreateStmt'
  | 'AlterTableStmt'
  | 'IndexStmt';

export type {
  Node,
  ParseResult,
  SelectStmt,
  InsertStmt,
  UpdateStmt,
  DeleteStmt,
  CreateStmt,
  AlterTableStmt,
  IndexStmt,
};
