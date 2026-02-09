import type { PgParser } from '../../pg-parser.js';
import type {
  Node,
  SelectStmt,
  ExprArg,
} from '../types.js';
import { AstQuery } from '../query.js';
import { col, coerce, coerceRight, sort, table, tableAlias } from '../nodes.js';
import { and } from '../expressions.js';

/**
 * Builder for SELECT statements.
 *
 * All methods are immutable — each returns a new SelectQuery instance.
 */
export class SelectQuery extends AstQuery<SelectStmt> {
  protected override _stmtType = 'SelectStmt';

  constructor(inner: SelectStmt, parser?: PgParser) {
    super(inner, parser);
  }

  protected override _clone(inner: SelectStmt): this {
    return new SelectQuery(inner, this.parser) as this;
  }

  /**
   * Add or replace the FROM clause.
   *
   * Value form: appends to existing fromClause.
   * Lambda form: full control over the array.
   */
  from(
    ...args:
      | [fn: (existing: Node[]) => Node[]]
      | (string | Node)[]
  ): SelectQuery {
    if (args.length === 1 && typeof args[0] === 'function') {
      const fn = args[0] as (existing: Node[]) => Node[];
      return this._clone({
        ...this.node,
        fromClause: fn(this.node.fromClause ?? []),
      });
    }

    const newItems = (args as (string | Node)[]).map((a) =>
      typeof a === 'string' ? table(a) : a
    );

    return this._clone({
      ...this.node,
      fromClause: [...(this.node.fromClause ?? []), ...newItems],
    });
  }

  /**
   * Add a WHERE condition.
   *
   * Value form: ANDs with existing whereClause.
   * Lambda form: receives existing clause, returns new clause.
   */
  where(
    exprOrFn: Node | ((existing?: Node) => Node | undefined)
  ): SelectQuery {
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
   * Add a HAVING condition.
   *
   * Value form: ANDs with existing.
   * Lambda form: full control.
   */
  having(
    exprOrFn: Node | ((existing?: Node) => Node | undefined)
  ): SelectQuery {
    if (typeof exprOrFn === 'function') {
      return this._clone({
        ...this.node,
        havingClause: exprOrFn(this.node.havingClause) ?? undefined,
      });
    }

    const combined = and(this.node.havingClause, exprOrFn);
    return this._clone({
      ...this.node,
      havingClause: combined,
    });
  }

  /**
   * Add to the ORDER BY clause.
   *
   * Value form: appends a sort element.
   * Lambda form: full control over the array.
   */
  orderBy(
    exprOrFn:
      | ExprArg
      | Node
      | ((existing: Node[]) => Node[]),
    dir?: 'asc' | 'desc'
  ): SelectQuery {
    if (typeof exprOrFn === 'function') {
      return this._clone({
        ...this.node,
        sortClause: (exprOrFn as (existing: Node[]) => Node[])(
          this.node.sortClause ?? []
        ),
      });
    }

    const sortNode = sort(exprOrFn as ExprArg, dir);
    return this._clone({
      ...this.node,
      sortClause: [...(this.node.sortClause ?? []), sortNode],
    });
  }

  /**
   * Set the LIMIT.
   *
   * Value form: overwrites.
   * Lambda form: receives existing, returns new.
   */
  limit(
    valueOrFn: number | Node | ((existing?: Node) => Node)
  ): SelectQuery {
    if (typeof valueOrFn === 'function') {
      return this._clone({
        ...this.node,
        limitCount: valueOrFn(this.node.limitCount),
        limitOption: 'LIMIT_OPTION_COUNT',
      });
    }

    const limitNode =
      typeof valueOrFn === 'number'
        ? { A_Const: { ival: { ival: valueOrFn } } }
        : valueOrFn;

    return this._clone({
      ...this.node,
      limitCount: limitNode as Node,
      limitOption: 'LIMIT_OPTION_COUNT',
    });
  }

  /**
   * Set the OFFSET.
   *
   * Value form: overwrites.
   * Lambda form: receives existing, returns new.
   */
  offset(
    valueOrFn: number | Node | ((existing?: Node) => Node)
  ): SelectQuery {
    if (typeof valueOrFn === 'function') {
      return this._clone({
        ...this.node,
        limitOffset: valueOrFn(this.node.limitOffset),
      });
    }

    const offsetNode =
      typeof valueOrFn === 'number'
        ? { A_Const: { ival: { ival: valueOrFn } } }
        : valueOrFn;

    return this._clone({
      ...this.node,
      limitOffset: offsetNode as Node,
    });
  }

  /**
   * Add to the GROUP BY clause.
   *
   * Value form: appends.
   * Lambda form: full control.
   */
  groupBy(
    ...args:
      | [fn: (existing: Node[]) => Node[]]
      | ExprArg[]
  ): SelectQuery {
    if (args.length === 1 && typeof args[0] === 'function') {
      const fn = args[0] as (existing: Node[]) => Node[];
      return this._clone({
        ...this.node,
        groupClause: fn(this.node.groupClause ?? []),
      });
    }

    const newItems = (args as ExprArg[]).map(coerce);
    return this._clone({
      ...this.node,
      groupClause: [
        ...(this.node.groupClause ?? []),
        ...newItems,
      ],
    });
  }

  /**
   * Add DISTINCT to the query.
   */
  distinct(): SelectQuery {
    return this._clone({
      ...this.node,
      distinctClause: [{} as Node],
    });
  }

  /**
   * Add a JOIN clause.
   */
  join(
    tableRef: string | Node,
    on: Node,
    joinType: 'JOIN_INNER' | 'JOIN_LEFT' | 'JOIN_FULL' | 'JOIN_RIGHT' = 'JOIN_INNER'
  ): SelectQuery {
    const tableNode =
      typeof tableRef === 'string' ? table(tableRef) : tableRef;

    const existing = this.node.fromClause ?? [];
    if (existing.length === 0) {
      throw new Error('Cannot add JOIN without a FROM clause');
    }

    // The last item in fromClause becomes the left arg of the join
    const lastFrom = existing[existing.length - 1];
    const joinExpr: Node = {
      JoinExpr: {
        jointype: joinType,
        larg: lastFrom,
        rarg: tableNode,
        quals: on,
      },
    };

    return this._clone({
      ...this.node,
      fromClause: [...existing.slice(0, -1), joinExpr],
    });
  }

  /**
   * Add a LEFT JOIN clause.
   */
  leftJoin(tableRef: string | Node, on: Node): SelectQuery {
    return this.join(tableRef, on, 'JOIN_LEFT');
  }

  /**
   * Add a RIGHT JOIN clause.
   */
  rightJoin(tableRef: string | Node, on: Node): SelectQuery {
    return this.join(tableRef, on, 'JOIN_RIGHT');
  }

  /**
   * Add a FULL JOIN clause.
   */
  fullJoin(tableRef: string | Node, on: Node): SelectQuery {
    return this.join(tableRef, on, 'JOIN_FULL');
  }

  /**
   * Add a CTE (WITH clause).
   */
  with(
    name: string,
    cteQuery: SelectQuery | AstQuery<SelectStmt>
  ): SelectQuery {
    const innerNode = cteQuery.node;
    const cte: Node = {
      CommonTableExpr: {
        ctename: name,
        ctematerialized: 'CTEMaterializeDefault',
        ctequery: {
          SelectStmt: {
            ...innerNode,
            op: innerNode.op ?? 'SETOP_NONE',
          },
        },
      },
    };

    const existingWith = this.node.withClause;
    return this._clone({
      ...this.node,
      withClause: {
        ctes: [...(existingWith?.ctes ?? []), cte],
        recursive: existingWith?.recursive,
      },
    });
  }

  /**
   * Create a UNION with another SELECT.
   */
  union(other: SelectQuery | AstQuery<SelectStmt>): SelectQuery {
    return new SelectQuery(
      {
        op: 'SETOP_UNION',
        larg: this.node,
        rarg: other.node,
      },
      this.parser
    );
  }

  /**
   * Create an EXCEPT with another SELECT.
   */
  except(other: SelectQuery | AstQuery<SelectStmt>): SelectQuery {
    return new SelectQuery(
      {
        op: 'SETOP_EXCEPT',
        larg: this.node,
        rarg: other.node,
      },
      this.parser
    );
  }

  /**
   * Create an INTERSECT with another SELECT.
   */
  intersect(other: SelectQuery | AstQuery<SelectStmt>): SelectQuery {
    return new SelectQuery(
      {
        op: 'SETOP_INTERSECT',
        larg: this.node,
        rarg: other.node,
      },
      this.parser
    );
  }

  /**
   * Add FOR UPDATE locking clause.
   */
  forUpdate(): SelectQuery {
    return this._clone({
      ...this.node,
      lockingClause: [
        ...(this.node.lockingClause ?? []),
        {
          LockingClause: {
            strength: 'LCS_FORUPDATE',
            waitPolicy: 'LockWaitBlock',
          },
        },
      ],
    });
  }

  /**
   * Add or modify the target list (SELECT columns).
   *
   * Value form: appends ResTarget nodes.
   * Lambda form: full control.
   */
  returning(
    ...args:
      | [fn: (existing: Node[]) => Node[]]
      | (string | Node)[]
  ): SelectQuery {
    if (args.length === 1 && typeof args[0] === 'function') {
      const fn = args[0] as (existing: Node[]) => Node[];
      return this._clone({
        ...this.node,
        targetList: fn(this.node.targetList ?? []),
      });
    }

    const newItems = (args as (string | Node)[]).map((a) =>
      typeof a === 'string'
        ? ({ ResTarget: { val: col(a) } } as Node)
        : a
    );

    return this._clone({
      ...this.node,
      targetList: [...(this.node.targetList ?? []), ...newItems],
    });
  }
}

/**
 * Create a new SelectQuery from column expressions.
 */
export function createSelect(
  columns: (string | Node)[],
  parser?: PgParser
): SelectQuery {
  const targetList: Node[] = columns.map((c) => {
    if (typeof c === 'string') {
      return { ResTarget: { val: col(c) } } as Node;
    }
    // Already a ResTarget — pass through
    if ('ResTarget' in c) return c;
    // Wrap other nodes (ColumnRef, FuncCall, etc.) in ResTarget
    return { ResTarget: { val: c } } as Node;
  });

  return new SelectQuery({ targetList, op: 'SETOP_NONE' }, parser);
}
