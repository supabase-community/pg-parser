// Core types
export type {
  NodeTypeName,
  NodeOfType,
  ExprArg,
  FindContext,
  Predicate,
  KnownStmtType,
  Node,
  ParseResult,
  SelectStmt,
  InsertStmt,
  UpdateStmt,
  DeleteStmt,
  CreateStmt,
  AlterTableStmt,
  IndexStmt,
} from './types.js';

// Node factories
export {
  col,
  val,
  star,
  table,
  tableAlias,
  alias,
  func,
  param,
  cast,
  sort,
  typeName,
  columnDef,
  coerce,
  coerceRight,
} from './nodes.js';

// Expression helpers
export {
  eq,
  neq,
  gt,
  gte,
  lt,
  lte,
  and,
  or,
  not,
  isNull,
  isNotNull,
  like,
  ilike,
  between,
  inList,
  exists,
  inSubquery,
  add,
  sub,
  mul,
  div,
} from './expressions.js';

// Traversal (internal helpers exposed for advanced use)
export { rawFind, rawTransform, rawVisit } from './traverse.js';

// Predicate helpers
export { hasTable, hasColumn, hasStar, inContext } from './predicates.js';

// Base class
export { AstQuery } from './query.js';

// Builder classes + types
export type { BuilderFor } from './builders/index.js';
export {
  SelectQuery,
  InsertQuery,
  UpdateQuery,
  DeleteQuery,
  CreateTableQuery,
  ColumnBuilder,
  AlterTableQuery,
  AlterColumnBuilder,
  CreateIndexQuery,
} from './builders/index.js';

// Factory + query entry point
export { createAstTools, query } from './factory.js';
