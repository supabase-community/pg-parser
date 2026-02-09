import type { PgParser } from '../../pg-parser.js';
import type { NodeOfType, NodeTypeName } from '../types.js';
import { AstQuery, setBuilderFactory } from '../query.js';
import { SelectQuery } from './select.js';
import { InsertQuery } from './insert.js';
import { UpdateQuery } from './update.js';
import { DeleteQuery } from './delete.js';
import { CreateTableQuery } from './create-table.js';
import { AlterTableQuery } from './alter-table.js';
import { CreateIndexQuery } from './create-index.js';

export { SelectQuery, createSelect } from './select.js';
export { InsertQuery, createInsert } from './insert.js';
export { UpdateQuery, createUpdate } from './update.js';
export { DeleteQuery, createDeleteFrom } from './delete.js';
export { CreateTableQuery, ColumnBuilder, createCreateTable } from './create-table.js';
export { AlterTableQuery, AlterColumnBuilder, createAlterTable } from './alter-table.js';
export { CreateIndexQuery, createCreateIndex } from './create-index.js';

/**
 * Type-safe builder resolution.
 *
 * Maps node type names to their corresponding builder classes.
 * Unknown types fall back to `AstQuery<NodeOfType<T>>`.
 */
export type BuilderFor<T extends NodeTypeName> =
  T extends 'SelectStmt'
    ? SelectQuery
    : T extends 'InsertStmt'
      ? InsertQuery
      : T extends 'UpdateStmt'
        ? UpdateQuery
        : T extends 'DeleteStmt'
          ? DeleteQuery
          : T extends 'CreateStmt'
            ? CreateTableQuery
            : T extends 'AlterTableStmt'
              ? AlterTableQuery
              : T extends 'IndexStmt'
                ? CreateIndexQuery
                : AstQuery<NodeOfType<T>>;

/**
 * Runtime builder factory. Creates the appropriate builder subclass
 * for a given node type.
 *
 * @internal
 */
function createBuilder(
  typeName: string,
  inner: unknown,
  parser?: PgParser
): AstQuery {
  switch (typeName) {
    case 'SelectStmt':
      return new SelectQuery(inner as NodeOfType<'SelectStmt'>, parser);
    case 'InsertStmt':
      return new InsertQuery(inner as NodeOfType<'InsertStmt'>, parser);
    case 'UpdateStmt':
      return new UpdateQuery(inner as NodeOfType<'UpdateStmt'>, parser);
    case 'DeleteStmt':
      return new DeleteQuery(inner as NodeOfType<'DeleteStmt'>, parser);
    case 'CreateStmt':
      return new CreateTableQuery(
        inner as NodeOfType<'CreateStmt'>,
        parser
      );
    case 'AlterTableStmt':
      return new AlterTableQuery(
        inner as NodeOfType<'AlterTableStmt'>,
        parser
      );
    case 'IndexStmt':
      return new CreateIndexQuery(
        inner as NodeOfType<'IndexStmt'>,
        parser
      );
    default:
      return new AstQuery(inner, parser);
  }
}

// Register the builder factory to break circular dependency
setBuilderFactory(createBuilder);
