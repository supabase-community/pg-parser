import type { PgParser } from '../../pg-parser.js';
import type {
  Node,
  UpdateStmt,
  ExprArg,
} from '../types.js';
import { AstQuery } from '../query.js';
import { col, table } from '../nodes.js';
import { and } from '../expressions.js';

/**
 * Builder for UPDATE statements.
 */
export class UpdateQuery extends AstQuery<UpdateStmt> {
  protected override _stmtType = 'UpdateStmt';

  constructor(inner: UpdateStmt, parser?: PgParser) {
    super(inner, parser);
  }

  protected override _clone(inner: UpdateStmt): this {
    return new UpdateQuery(inner, this.parser) as this;
  }

  /**
   * Set columns to update.
   *
   * Value form: merges with existing.
   * Lambda form: full control.
   */
  set(
    fieldsOrFn:
      | Record<string, Node>
      | ((existing: Node[]) => Node[])
  ): UpdateQuery {
    if (typeof fieldsOrFn === 'function') {
      return this._clone({
        ...this.node,
        targetList: fieldsOrFn(this.node.targetList ?? []),
      });
    }

    const newTargets = Object.entries(fieldsOrFn).map(
      ([name, value]) =>
        ({
          ResTarget: {
            name,
            val: value,
          },
        }) as Node
    );

    return this._clone({
      ...this.node,
      targetList: [...(this.node.targetList ?? []), ...newTargets],
    });
  }

  /**
   * Add a WHERE condition.
   *
   * Value form: ANDs with existing.
   * Lambda form: full control.
   */
  where(
    exprOrFn: Node | ((existing?: Node) => Node | undefined)
  ): UpdateQuery {
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
   * Add FROM clause (for UPDATE ... FROM ...).
   */
  from(...tables: (string | Node)[]): UpdateQuery {
    const newItems = tables.map((t) =>
      typeof t === 'string' ? table(t) : t
    );

    return this._clone({
      ...this.node,
      fromClause: [...(this.node.fromClause ?? []), ...newItems],
    });
  }

  /**
   * Add RETURNING clause.
   */
  returning(...names: (string | Node)[]): UpdateQuery {
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
 * Create a new UpdateQuery for a table.
 */
export function createUpdate(
  tableName: string | Node,
  parser?: PgParser
): UpdateQuery {
  const relation =
    typeof tableName === 'string'
      ? { relname: tableName, inh: true, relpersistence: 'p' as const }
      : (tableName as { RangeVar: UpdateStmt['relation'] }).RangeVar;

  return new UpdateQuery({ relation }, parser);
}
