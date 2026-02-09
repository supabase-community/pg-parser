import type { PgParser } from '../pg-parser.js';
import type { Node, ParseResult } from './types.js';
import { AstQuery } from './query.js';
import {
  SelectQuery,
  createSelect,
  InsertQuery,
  createInsert,
  UpdateQuery,
  createUpdate,
  DeleteQuery,
  createDeleteFrom,
  CreateTableQuery,
  createCreateTable,
  AlterTableQuery,
  createAlterTable,
  CreateIndexQuery,
  createCreateIndex,
} from './builders/index.js';

/**
 * Wrap an existing AST node in the appropriate builder class.
 *
 * Accepts both `ParseResult` (multi-statement) and individual
 * unwrapped statement nodes.
 */
export function query(node: ParseResult, parser?: PgParser): AstQuery<ParseResult>;
export function query(
  node: Record<string, unknown>,
  parser?: PgParser
): AstQuery;
export function query(
  node: ParseResult | Record<string, unknown>,
  parser?: PgParser
): AstQuery {
  // ParseResult: has stmts array
  if ('stmts' in node) {
    return new AstQuery(node as ParseResult, parser);
  }

  // Detect statement type from field patterns
  if (
    'targetList' in node ||
    'fromClause' in node ||
    'op' in node ||
    'valuesLists' in node
  ) {
    return new SelectQuery(node as Record<string, unknown> as any, parser);
  }

  if ('relation' in node && 'cols' in node) {
    return new InsertQuery(node as any, parser);
  }

  if ('relation' in node && 'targetList' in node) {
    return new UpdateQuery(node as any, parser);
  }

  if ('relation' in node && ('usingClause' in node || 'whereClause' in node)) {
    return new DeleteQuery(node as any, parser);
  }

  if ('tableElts' in node) {
    return new CreateTableQuery(node as any, parser);
  }

  if ('cmds' in node && 'objtype' in node) {
    return new AlterTableQuery(node as any, parser);
  }

  if ('idxname' in node || 'indexParams' in node) {
    return new CreateIndexQuery(node as any, parser);
  }

  return new AstQuery(node, parser);
}

/**
 * Bind a PgParser instance to all builders and the query function.
 *
 * Returns factory functions with the parser pre-bound so you don't
 * have to pass it everywhere.
 *
 * @example
 * const { select, insert, update, deleteFrom, query } = createAstTools(parser)
 * const sql = await select('id', 'name').from('users').toSQL()
 */
export function createAstTools(parser: PgParser) {
  return {
    select(...columns: (string | Node)[]) {
      return createSelect(columns, parser);
    },

    insert(into: string | Node) {
      return createInsert(into, parser);
    },

    update(tbl: string | Node) {
      return createUpdate(tbl, parser);
    },

    deleteFrom(tbl: string | Node) {
      return createDeleteFrom(tbl, parser);
    },

    createTable(name: string, schema?: string) {
      return createCreateTable(name, schema, parser);
    },

    alterTable(name: string, schema?: string) {
      return createAlterTable(name, schema, parser);
    },

    createIndex(name: string) {
      return createCreateIndex(name, parser);
    },

    query(node: ParseResult | Record<string, unknown>) {
      return query(node as Record<string, unknown>, parser);
    },
  };
}
