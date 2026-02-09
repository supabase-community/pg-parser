import type { Node } from '../../wasm/17/pg-parser-types.js';
import type { ExprArg } from './types.js';

/**
 * Creates a column reference node.
 *
 * Accepts multiple parts for qualified refs, or a single
 * dotted string that will be split automatically.
 *
 * @example
 * col('id')        // → unqualified column
 * col('u', 'id')   // → qualified: u.id
 * col('u.id')      // → same as col('u', 'id')
 */
export function col(...parts: string[]): Node {
  const fields =
    parts.length === 1 ? parts[0]!.split('.') : parts;

  return {
    ColumnRef: {
      fields: fields.map((p) => ({ String: { sval: p } })),
    },
  };
}

/**
 * Creates a constant value node.
 *
 * Auto-detects the appropriate A_Const variant based on the JS type.
 *
 * @example
 * val('hello')  // → string constant
 * val(42)       // → integer constant
 * val(3.14)     // → float constant
 * val(true)     // → boolean constant
 * val(null)     // → NULL
 */
export function val(value: string | number | boolean | null): Node {
  if (value === null) {
    return { A_Const: { isnull: true } };
  }

  if (typeof value === 'boolean') {
    return { A_Const: { boolval: { boolval: value } } };
  }

  if (typeof value === 'number') {
    if (Number.isInteger(value)) {
      return { A_Const: { ival: { ival: value } } };
    }
    return { A_Const: { fval: { fval: String(value) } } };
  }

  return { A_Const: { sval: { sval: value } } };
}

/**
 * Creates a star (*) column reference, optionally qualified with a table name.
 *
 * @example
 * star()         // → *
 * star('users')  // → users.*
 */
export function star(tableName?: string): Node {
  const fields: Node[] = [];

  if (tableName) {
    fields.push({ String: { sval: tableName } });
  }

  fields.push({ A_Star: {} });

  return { ColumnRef: { fields } };
}

/**
 * Creates a table reference (RangeVar) node.
 *
 * @example
 * table('users')               // → users
 * table('users', 'public')     // → public.users
 */
export function table(name: string, schema?: string): Node {
  return {
    RangeVar: {
      relname: name,
      ...(schema ? { schemaname: schema } : {}),
      inh: true,
      relpersistence: 'p',
    },
  };
}

/**
 * Creates a table reference with an alias.
 *
 * @example
 * tableAlias('users', 'u')  // → users u
 */
export function tableAlias(name: string, aliasName: string): Node {
  return {
    RangeVar: {
      relname: name,
      inh: true,
      relpersistence: 'p',
      alias: { aliasname: aliasName },
    },
  };
}

/**
 * Creates a ResTarget node with an alias (for SELECT target lists).
 *
 * @example
 * alias(col('name'), 'user_name')  // → name AS user_name
 */
export function alias(expr: Node, name: string): Node {
  return {
    ResTarget: {
      name,
      val: expr,
    },
  };
}

/**
 * Creates a function call node.
 *
 * Handles the special case of aggregate star (e.g., count(*))
 * by setting agg_star instead of passing args.
 *
 * @example
 * func('now')                              // → now()
 * func('count', star())                    // → count(*)
 * func('date_trunc', val('month'), col('created_at'))
 */
export function func(name: string, ...args: ExprArg[]): Node {
  const coercedArgs = args.map(coerce);

  // Detect count(*) pattern: single star arg → use agg_star
  if (
    coercedArgs.length === 1 &&
    isStarNode(coercedArgs[0]!)
  ) {
    return {
      FuncCall: {
        funcname: [{ String: { sval: name } }],
        agg_star: true,
      },
    };
  }

  return {
    FuncCall: {
      funcname: [{ String: { sval: name } }],
      ...(coercedArgs.length > 0 ? { args: coercedArgs } : {}),
    },
  };
}

/**
 * Creates a parameter reference ($1, $2, etc).
 *
 * @example
 * param(1)  // → $1
 */
export function param(n: number): Node {
  return { ParamRef: { number: n } };
}

/**
 * Creates a type cast node.
 *
 * @example
 * cast(col('id'), 'text')  // → id::text
 */
export function cast(expr: Node, type: string): Node {
  return {
    TypeCast: {
      arg: expr,
      typeName: {
        names: [
          { String: { sval: 'pg_catalog' } },
          { String: { sval: type } },
        ],
      },
    },
  };
}

/**
 * Creates a SortBy node for ORDER BY clauses.
 *
 * @example
 * sort(col('created_at'), 'desc')
 * sort(col('name'), 'asc', 'nulls_first')
 */
export function sort(
  expr: ExprArg,
  dir?: 'asc' | 'desc',
  nulls?: 'nulls_first' | 'nulls_last'
): Node {
  return {
    SortBy: {
      node: coerce(expr),
      sortby_dir:
        dir === 'asc'
          ? 'SORTBY_ASC'
          : dir === 'desc'
            ? 'SORTBY_DESC'
            : 'SORTBY_DEFAULT',
      sortby_nulls:
        nulls === 'nulls_first'
          ? 'SORTBY_NULLS_FIRST'
          : nulls === 'nulls_last'
            ? 'SORTBY_NULLS_LAST'
            : 'SORTBY_NULLS_DEFAULT',
    },
  };
}

/**
 * Creates a TypeName node for DDL type references.
 *
 * @example
 * typeName('text')
 * typeName('varchar', 255)
 */
export function typeName(name: string, mod?: number): Node {
  return {
    TypeName: {
      names: [{ String: { sval: name } }],
      ...(mod !== undefined
        ? {
            typmods: [
              { A_Const: { ival: { ival: mod } } },
            ],
          }
        : {}),
    },
  };
}

/**
 * Creates a ColumnDef node for CREATE TABLE.
 *
 * @example
 * columnDef('id', 'bigint')
 * columnDef('name', 'text')
 */
export function columnDef(name: string, type: string): Node {
  return {
    ColumnDef: {
      colname: name,
      typeName: {
        names: [{ String: { sval: type } }],
      },
    },
  };
}

/**
 * Default coercion: string → col (with dot splitting), primitives → val.
 */
export function coerce(arg: ExprArg): Node {
  if (arg === null) return val(null);
  if (typeof arg === 'string') return col(arg);
  if (typeof arg === 'number' || typeof arg === 'boolean') return val(arg);
  return arg;
}

/**
 * Right-side coercion: string → val (not col), primitives → val.
 */
export function coerceRight(arg: ExprArg): Node {
  if (arg === null) return val(null);
  if (typeof arg === 'string') return val(arg);
  if (typeof arg === 'number' || typeof arg === 'boolean') return val(arg);
  return arg;
}

function isStarNode(node: Node): boolean {
  return (
    'ColumnRef' in node &&
    Array.isArray((node as { ColumnRef: { fields?: Node[] } }).ColumnRef.fields) &&
    (node as { ColumnRef: { fields: Node[] } }).ColumnRef.fields.some(
      (f) => 'A_Star' in f
    )
  );
}
