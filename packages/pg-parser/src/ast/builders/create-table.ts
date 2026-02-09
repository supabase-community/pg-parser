import type { PgParser } from '../../pg-parser.js';
import type {
  Node,
  CreateStmt,
  ExprArg,
} from '../types.js';
import { AstQuery } from '../query.js';
import { val } from '../nodes.js';

/**
 * Immutable builder for column constraints.
 *
 * Each method returns a new ColumnBuilder with the constraint appended.
 */
export class ColumnBuilder {
  readonly _constraints: readonly Node[];

  constructor(constraints: readonly Node[] = []) {
    this._constraints = constraints;
  }

  notNull(): ColumnBuilder {
    return new ColumnBuilder([...this._constraints, {
      Constraint: { contype: 'CONSTR_NOTNULL' },
    } as Node]);
  }

  primaryKey(): ColumnBuilder {
    return new ColumnBuilder([...this._constraints, {
      Constraint: { contype: 'CONSTR_PRIMARY' },
    } as Node]);
  }

  unique(): ColumnBuilder {
    return new ColumnBuilder([...this._constraints, {
      Constraint: { contype: 'CONSTR_UNIQUE' },
    } as Node]);
  }

  default(expr: Node): ColumnBuilder {
    return new ColumnBuilder([...this._constraints, {
      Constraint: {
        contype: 'CONSTR_DEFAULT',
        raw_expr: expr,
      },
    } as Node]);
  }

  references(tableName: string, column: string): ColumnBuilder {
    return new ColumnBuilder([...this._constraints, {
      Constraint: {
        contype: 'CONSTR_FOREIGN',
        pktable: {
          relname: tableName,
          inh: true,
          relpersistence: 'p',
        },
        pk_attrs: [{ String: { sval: column } }],
      },
    } as Node]);
  }
}

/**
 * Builder for CREATE TABLE statements.
 */
export class CreateTableQuery extends AstQuery<CreateStmt> {
  protected override _stmtType = 'CreateStmt';

  constructor(inner: CreateStmt, parser?: PgParser) {
    super(inner, parser);
  }

  protected override _clone(inner: CreateStmt): this {
    return new CreateTableQuery(inner, this.parser) as this;
  }

  /**
   * Add or modify a column.
   *
   * Overloads:
   * - `column(name, type)` — add column with type
   * - `column(name, type, fn)` — add column with type and constraints
   * - `column(name, fn)` — modify existing column constraints (keep type)
   */
  column(name: string, type: string): CreateTableQuery;
  column(
    name: string,
    type: string,
    fn: (cb: ColumnBuilder) => ColumnBuilder
  ): CreateTableQuery;
  column(
    name: string,
    fn: (cb: ColumnBuilder) => ColumnBuilder
  ): CreateTableQuery;
  column(
    name: string,
    typeOrFn: string | ((cb: ColumnBuilder) => ColumnBuilder),
    maybeFn?: (cb: ColumnBuilder) => ColumnBuilder
  ): CreateTableQuery {
    const existing = this.node.tableElts ?? [];
    const existingIdx = existing.findIndex(
      (e) =>
        'ColumnDef' in e &&
        (e as { ColumnDef: { colname?: string } }).ColumnDef.colname === name
    );

    let typeName: string | undefined;
    let fn: ((cb: ColumnBuilder) => ColumnBuilder) | undefined;

    if (typeof typeOrFn === 'string') {
      typeName = typeOrFn;
      fn = maybeFn;
    } else {
      fn = typeOrFn;
    }

    const result = fn ? fn(new ColumnBuilder()) : new ColumnBuilder();

    const colDef: Node = {
      ColumnDef: {
        colname: name,
        ...(typeName
          ? {
              typeName: {
                names: [{ String: { sval: typeName } }],
              },
            }
          : existingIdx >= 0
            ? {
                typeName: (existing[existingIdx] as any).ColumnDef
                  ?.typeName,
              }
            : {}),
        ...(result._constraints.length > 0
          ? { constraints: [...result._constraints] }
          : {}),
      },
    };

    const newElts = [...existing];
    if (existingIdx >= 0) {
      newElts[existingIdx] = colDef;
    } else {
      newElts.push(colDef);
    }

    return this._clone({
      ...this.node,
      tableElts: newElts,
    });
  }

  /**
   * Lambda over all columns.
   */
  columns(fn: (existing: Node[]) => Node[]): CreateTableQuery {
    return this._clone({
      ...this.node,
      tableElts: fn(this.node.tableElts ?? []),
    });
  }

  /**
   * Drop a column by name.
   */
  dropColumn(name: string): CreateTableQuery {
    return this._clone({
      ...this.node,
      tableElts: (this.node.tableElts ?? []).filter(
        (e) =>
          !(
            'ColumnDef' in e &&
            (e as { ColumnDef: { colname?: string } }).ColumnDef
              .colname === name
          )
      ),
    });
  }

  /**
   * Add a PRIMARY KEY constraint on the given columns.
   */
  primaryKey(...columns: string[]): CreateTableQuery {
    return this._clone({
      ...this.node,
      tableElts: [
        ...(this.node.tableElts ?? []),
        {
          Constraint: {
            contype: 'CONSTR_PRIMARY',
            keys: columns.map((c) => ({ String: { sval: c } })),
          },
        } as Node,
      ],
    });
  }

  /**
   * Add a UNIQUE constraint on the given columns.
   */
  unique(...columns: string[]): CreateTableQuery {
    return this._clone({
      ...this.node,
      tableElts: [
        ...(this.node.tableElts ?? []),
        {
          Constraint: {
            contype: 'CONSTR_UNIQUE',
            keys: columns.map((c) => ({ String: { sval: c } })),
          },
        } as Node,
      ],
    });
  }

  /**
   * Add a CHECK constraint.
   */
  check(expr: Node): CreateTableQuery {
    return this._clone({
      ...this.node,
      tableElts: [
        ...(this.node.tableElts ?? []),
        {
          Constraint: {
            contype: 'CONSTR_CHECK',
            raw_expr: expr,
          },
        } as Node,
      ],
    });
  }

  /**
   * Add a FOREIGN KEY constraint.
   */
  foreignKey(
    columns: string[],
    refTable: string,
    refColumns: string[]
  ): CreateTableQuery {
    return this._clone({
      ...this.node,
      tableElts: [
        ...(this.node.tableElts ?? []),
        {
          Constraint: {
            contype: 'CONSTR_FOREIGN',
            fk_attrs: columns.map((c) => ({
              String: { sval: c },
            })),
            pktable: {
              relname: refTable,
              inh: true,
              relpersistence: 'p',
            },
            pk_attrs: refColumns.map((c) => ({
              String: { sval: c },
            })),
          },
        } as Node,
      ],
    });
  }

  /**
   * Add IF NOT EXISTS.
   */
  ifNotExists(): CreateTableQuery {
    return this._clone({
      ...this.node,
      if_not_exists: true,
    });
  }
}

/**
 * Create a new CreateTableQuery.
 */
export function createCreateTable(
  name: string,
  schema?: string,
  parser?: PgParser
): CreateTableQuery {
  return new CreateTableQuery(
    {
      relation: {
        relname: name,
        ...(schema ? { schemaname: schema } : {}),
        inh: true,
        relpersistence: 'p',
      },
      tableElts: [],
    },
    parser
  );
}
