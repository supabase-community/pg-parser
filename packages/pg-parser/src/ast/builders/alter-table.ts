import type { PgParser } from '../../pg-parser.js';
import type {
  Node,
  AlterTableStmt,
} from '../types.js';
import { AstQuery } from '../query.js';
import { ColumnBuilder } from './create-table.js';

/**
 * Immutable builder for ALTER COLUMN operations.
 *
 * Each method returns a new AlterColumnBuilder with the command appended.
 */
export class AlterColumnBuilder {
  readonly _cmds: readonly Node[];

  constructor(private readonly _name: string, cmds: readonly Node[] = []) {
    this._cmds = cmds;
  }

  setNotNull(): AlterColumnBuilder {
    return new AlterColumnBuilder(this._name, [...this._cmds, {
      AlterTableCmd: { subtype: 'AT_SetNotNull', name: this._name },
    } as Node]);
  }

  dropNotNull(): AlterColumnBuilder {
    return new AlterColumnBuilder(this._name, [...this._cmds, {
      AlterTableCmd: { subtype: 'AT_DropNotNull', name: this._name },
    } as Node]);
  }
}

/**
 * Builder for ALTER TABLE statements.
 */
export class AlterTableQuery extends AstQuery<AlterTableStmt> {
  protected override _stmtType = 'AlterTableStmt';

  constructor(inner: AlterTableStmt, parser?: PgParser) {
    super(inner, parser);
  }

  protected override _clone(inner: AlterTableStmt): this {
    return new AlterTableQuery(inner, this.parser) as this;
  }

  /**
   * Add a column to the table.
   */
  addColumn(
    name: string,
    type: string,
    fn?: (cb: ColumnBuilder) => ColumnBuilder
  ): AlterTableQuery {
    const result = fn ? fn(new ColumnBuilder()) : new ColumnBuilder();

    const colDef: Node = {
      ColumnDef: {
        colname: name,
        typeName: {
          names: [{ String: { sval: type } }],
        },
        ...(result._constraints.length > 0
          ? { constraints: [...result._constraints] }
          : {}),
      },
    };

    const cmd: Node = {
      AlterTableCmd: {
        subtype: 'AT_AddColumn',
        def: colDef,
      },
    };

    return this._clone({
      ...this.node,
      cmds: [...(this.node.cmds ?? []), cmd],
    });
  }

  /**
   * Drop a column.
   */
  dropColumn(name: string): AlterTableQuery {
    const cmd: Node = {
      AlterTableCmd: {
        subtype: 'AT_DropColumn',
        name,
      },
    };

    return this._clone({
      ...this.node,
      cmds: [...(this.node.cmds ?? []), cmd],
    });
  }

  /**
   * Rename a column.
   */
  renameColumn(_oldName: string, _newName: string): AlterTableQuery {
    throw new Error(
      'renameColumn requires RenameStmt which is not yet supported. ' +
        'Use raw AST construction for column renames.'
    );
  }

  /**
   * Alter a column (e.g., SET NOT NULL).
   */
  alterColumn(
    name: string,
    fn: (cb: AlterColumnBuilder) => AlterColumnBuilder
  ): AlterTableQuery {
    const result = fn(new AlterColumnBuilder(name));

    return this._clone({
      ...this.node,
      cmds: [...(this.node.cmds ?? []), ...result._cmds],
    });
  }

  /**
   * Add a constraint.
   */
  addConstraint(constraint: Node): AlterTableQuery {
    const cmd: Node = {
      AlterTableCmd: {
        subtype: 'AT_AddConstraint',
        def: constraint,
      },
    };

    return this._clone({
      ...this.node,
      cmds: [...(this.node.cmds ?? []), cmd],
    });
  }

  /**
   * Drop a constraint by name.
   */
  dropConstraint(name: string): AlterTableQuery {
    const cmd: Node = {
      AlterTableCmd: {
        subtype: 'AT_DropConstraint',
        name,
      },
    };

    return this._clone({
      ...this.node,
      cmds: [...(this.node.cmds ?? []), cmd],
    });
  }
}

/**
 * Create a new AlterTableQuery.
 */
export function createAlterTable(
  name: string,
  schema?: string,
  parser?: PgParser
): AlterTableQuery {
  return new AlterTableQuery(
    {
      relation: {
        relname: name,
        ...(schema ? { schemaname: schema } : {}),
        inh: true,
        relpersistence: 'p',
      },
      cmds: [],
      objtype: 'OBJECT_TABLE',
    },
    parser
  );
}
