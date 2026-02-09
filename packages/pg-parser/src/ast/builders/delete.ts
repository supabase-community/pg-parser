import type { PgParser } from '../../pg-parser.js';
import type {
  Node,
  DeleteStmt,
} from '../types.js';
import { AstQuery } from '../query.js';
import { col, table } from '../nodes.js';
import { and } from '../expressions.js';

/**
 * Builder for DELETE statements.
 */
export class DeleteQuery extends AstQuery<DeleteStmt> {
  protected override _stmtType = 'DeleteStmt';

  constructor(inner: DeleteStmt, parser?: PgParser) {
    super(inner, parser);
  }

  protected override _clone(inner: DeleteStmt): this {
    return new DeleteQuery(inner, this.parser) as this;
  }

  /**
   * Add a WHERE condition.
   *
   * Value form: ANDs with existing.
   * Lambda form: full control.
   */
  where(
    exprOrFn: Node | ((existing?: Node) => Node | undefined)
  ): DeleteQuery {
    if (typeof exprOrFn === 'function') {
      return this._clone({
        ...this.node,
        whereClause: exprOrFn(this.node.whereClause) ?? undefined,
      });
    }

    const combined = and(this.node.whereClause, exprOrFn);
    return this._clone({
      ...this.node,
      whereClause: combined,
    });
  }

  /**
   * Add USING clause.
   */
  using(...tables: (string | Node)[]): DeleteQuery {
    const newItems = tables.map((t) =>
      typeof t === 'string' ? table(t) : t
    );

    return this._clone({
      ...this.node,
      usingClause: [
        ...(this.node.usingClause ?? []),
        ...newItems,
      ],
    });
  }

  /**
   * Add RETURNING clause.
   */
  returning(...names: (string | Node)[]): DeleteQuery {
    const items = names.map((n) =>
      typeof n === 'string'
        ? ({ ResTarget: { val: col(n) } } as Node)
        : n
    );

    return this._clone({
      ...this.node,
      returningList: [
        ...(this.node.returningList ?? []),
        ...items,
      ],
    });
  }
}

/**
 * Create a new DeleteQuery for a table.
 */
export function createDeleteFrom(
  tableName: string | Node,
  parser?: PgParser
): DeleteQuery {
  const relation =
    typeof tableName === 'string'
      ? { relname: tableName, inh: true, relpersistence: 'p' as const }
      : (tableName as { RangeVar: DeleteStmt['relation'] }).RangeVar;

  return new DeleteQuery({ relation }, parser);
}
