import type { PgParser } from '../../pg-parser.js';
import type {
  Node,
  IndexStmt,
} from '../types.js';
import { AstQuery } from '../query.js';

/**
 * Builder for CREATE INDEX statements.
 */
export class CreateIndexQuery extends AstQuery<IndexStmt> {
  protected override _stmtType = 'IndexStmt';

  constructor(inner: IndexStmt, parser?: PgParser) {
    super(inner, parser);
  }

  protected override _clone(inner: IndexStmt): this {
    return new CreateIndexQuery(inner, this.parser) as this;
  }

  /**
   * Set the table the index is on.
   */
  on(tableName: string, schema?: string): CreateIndexQuery {
    return this._clone({
      ...this.node,
      relation: {
        relname: tableName,
        ...(schema ? { schemaname: schema } : {}),
        inh: true,
        relpersistence: 'p',
      },
    });
  }

  /**
   * Set the indexed columns.
   */
  columns(...names: string[]): CreateIndexQuery {
    return this._clone({
      ...this.node,
      indexParams: names.map(
        (name) =>
          ({
            IndexElem: {
              name,
              ordering: 'SORTBY_DEFAULT',
              nulls_ordering: 'SORTBY_NULLS_DEFAULT',
            },
          }) as Node
      ),
    });
  }

  /**
   * Set the access method (btree, hash, gist, gin, etc).
   */
  using(method: string): CreateIndexQuery {
    return this._clone({
      ...this.node,
      accessMethod: method,
    });
  }

  /**
   * Make the index unique.
   */
  unique(): CreateIndexQuery {
    return this._clone({
      ...this.node,
      unique: true,
    });
  }

  /**
   * Add a WHERE clause (partial index).
   */
  where(expr: Node): CreateIndexQuery {
    return this._clone({
      ...this.node,
      whereClause: expr,
    });
  }

  /**
   * Create index concurrently.
   */
  concurrently(): CreateIndexQuery {
    return this._clone({
      ...this.node,
      concurrent: true,
    });
  }

  /**
   * Add IF NOT EXISTS.
   */
  ifNotExists(): CreateIndexQuery {
    return this._clone({
      ...this.node,
      if_not_exists: true,
    });
  }

  /**
   * Add INCLUDE columns (covering index).
   */
  include(...names: string[]): CreateIndexQuery {
    return this._clone({
      ...this.node,
      indexIncludingParams: names.map(
        (name) =>
          ({
            IndexElem: {
              name,
              ordering: 'SORTBY_DEFAULT',
              nulls_ordering: 'SORTBY_NULLS_DEFAULT',
            },
          }) as Node
      ),
    });
  }
}

/**
 * Create a new CreateIndexQuery.
 */
export function createCreateIndex(
  name: string,
  parser?: PgParser
): CreateIndexQuery {
  return new CreateIndexQuery(
    {
      idxname: name,
      accessMethod: 'btree',
    },
    parser
  );
}
