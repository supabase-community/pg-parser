import type { PgParser } from '../../pg-parser.js';
import type {
  Node,
  InsertStmt,
  ExprArg,
} from '../types.js';
import { AstQuery } from '../query.js';
import { col, coerceRight, table, val } from '../nodes.js';
import type { SelectQuery } from './select.js';

/**
 * Builder for INSERT statements.
 */
export class InsertQuery extends AstQuery<InsertStmt> {
  protected override _stmtType = 'InsertStmt';

  constructor(inner: InsertStmt, parser?: PgParser) {
    super(inner, parser);
  }

  protected override _clone(inner: InsertStmt): this {
    return new InsertQuery(inner, this.parser) as this;
  }

  /**
   * Set the column list for the INSERT.
   */
  columns(...names: string[]): InsertQuery {
    return this._clone({
      ...this.node,
      cols: names.map(
        (name) => ({ ResTarget: { name } }) as Node
      ),
    });
  }

  /**
   * Set the VALUES for a single-row INSERT.
   *
   * Creates a SELECT with valuesLists containing the provided values.
   */
  values(...args: ExprArg[]): InsertQuery {
    const valueNodes = args.map(coerceRight);

    return this._clone({
      ...this.node,
      selectStmt: {
        SelectStmt: {
          valuesLists: [{ List: { items: valueNodes } }],
        },
      },
    });
  }

  /**
   * Use a SELECT as the source for the INSERT.
   */
  fromSelect(
    query: SelectQuery | AstQuery<unknown>
  ): InsertQuery {
    return this._clone({
      ...this.node,
      selectStmt: { SelectStmt: query.node } as Node,
    });
  }

  /**
   * Add ON CONFLICT clause.
   */
  onConflict(config: {
    columns?: string[];
    action?: 'nothing' | { set: Record<string, Node> };
    where?: Node;
  }): InsertQuery {
    const infer = config.columns
      ? {
          indexElems: config.columns.map(
            (c) => ({ IndexElem: { name: c } }) as Node
          ),
        }
      : undefined;

    let action: 'ONCONFLICT_NOTHING' | 'ONCONFLICT_UPDATE';
    let targetList: Node[] | undefined;

    if (config.action === 'nothing') {
      action = 'ONCONFLICT_NOTHING';
    } else if (config.action && typeof config.action === 'object') {
      action = 'ONCONFLICT_UPDATE';
      targetList = Object.entries(config.action.set).map(
        ([name, value]) =>
          ({
            ResTarget: {
              name,
              val: value,
            },
          }) as Node
      );
    } else {
      action = 'ONCONFLICT_NOTHING';
    }

    return this._clone({
      ...this.node,
      onConflictClause: {
        action,
        infer,
        ...(targetList ? { targetList } : {}),
        ...(config.where ? { whereClause: config.where } : {}),
      },
    });
  }

  /**
   * Add RETURNING clause.
   */
  returning(...names: (string | Node)[]): InsertQuery {
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
 * Create a new InsertQuery for a table.
 */
export function createInsert(
  tableName: string | Node,
  parser?: PgParser
): InsertQuery {
  const relation =
    typeof tableName === 'string'
      ? { relname: tableName, inh: true, relpersistence: 'p' as const }
      : (tableName as { RangeVar: InsertStmt['relation'] }).RangeVar;

  return new InsertQuery({ relation }, parser);
}
