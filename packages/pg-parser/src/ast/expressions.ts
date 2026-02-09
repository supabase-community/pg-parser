import type { Node } from '../../wasm/17/pg-parser-types.js';
import type { ExprArg } from './types.js';
import { coerce, coerceRight } from './nodes.js';

/**
 * Helper to create an A_Expr node with an operator.
 */
function aExpr(
  kind: string,
  op: string,
  left: Node,
  right: Node
): Node {
  return {
    A_Expr: {
      kind: kind as 'AEXPR_OP',
      name: [{ String: { sval: op } }],
      lexpr: left,
      rexpr: right,
    },
  };
}

// ── Comparison operators ────────────────────────────────────

/**
 * Equality: `left = right`
 *
 * Left string → col, right string → val.
 */
export function eq(left: ExprArg, right: ExprArg): Node {
  return aExpr('AEXPR_OP', '=', coerce(left), coerceRight(right));
}

/**
 * Not equal: `left <> right`
 */
export function neq(left: ExprArg, right: ExprArg): Node {
  return aExpr('AEXPR_OP', '<>', coerce(left), coerceRight(right));
}

/**
 * Greater than: `left > right`
 */
export function gt(left: ExprArg, right: ExprArg): Node {
  return aExpr('AEXPR_OP', '>', coerce(left), coerceRight(right));
}

/**
 * Greater than or equal: `left >= right`
 */
export function gte(left: ExprArg, right: ExprArg): Node {
  return aExpr('AEXPR_OP', '>=', coerce(left), coerceRight(right));
}

/**
 * Less than: `left < right`
 */
export function lt(left: ExprArg, right: ExprArg): Node {
  return aExpr('AEXPR_OP', '<', coerce(left), coerceRight(right));
}

/**
 * Less than or equal: `left <= right`
 */
export function lte(left: ExprArg, right: ExprArg): Node {
  return aExpr('AEXPR_OP', '<=', coerce(left), coerceRight(right));
}

// ── Boolean operators ───────────────────────────────────────

/**
 * AND combinator. Silently skips undefined args.
 *
 * @example
 * and(eq('a', 1), eq('b', 2))  // a = 1 AND b = 2
 * and(existing, eq('c', 3))    // existing AND c = 3
 */
export function and(
  ...exprs: (Node | undefined)[]
): Node | undefined {
  const filtered = exprs.filter(
    (e): e is Node => e !== undefined
  );

  if (filtered.length === 0) return undefined;
  if (filtered.length === 1) return filtered[0];

  return {
    BoolExpr: {
      boolop: 'AND_EXPR',
      args: filtered,
    },
  };
}

/**
 * OR combinator. Silently skips undefined args.
 *
 * @example
 * or(eq('a', 1), eq('b', 2))  // a = 1 OR b = 2
 */
export function or(
  ...exprs: (Node | undefined)[]
): Node | undefined {
  const filtered = exprs.filter(
    (e): e is Node => e !== undefined
  );

  if (filtered.length === 0) return undefined;
  if (filtered.length === 1) return filtered[0];

  return {
    BoolExpr: {
      boolop: 'OR_EXPR',
      args: filtered,
    },
  };
}

/**
 * NOT operator.
 *
 * @example
 * not(eq('active', true))  // NOT active = true
 */
export function not(expr: Node): Node {
  return {
    BoolExpr: {
      boolop: 'NOT_EXPR',
      args: [expr],
    },
  };
}

// ── Null tests ──────────────────────────────────────────────

/**
 * IS NULL test.
 *
 * @example
 * isNull('deleted_at')  // deleted_at IS NULL
 */
export function isNull(expr: ExprArg): Node {
  return {
    NullTest: {
      arg: coerce(expr),
      nulltesttype: 'IS_NULL',
    },
  };
}

/**
 * IS NOT NULL test.
 *
 * @example
 * isNotNull('email')  // email IS NOT NULL
 */
export function isNotNull(expr: ExprArg): Node {
  return {
    NullTest: {
      arg: coerce(expr),
      nulltesttype: 'IS_NOT_NULL',
    },
  };
}

// ── Pattern matching ────────────────────────────────────────

/**
 * LIKE operator.
 *
 * @example
 * like('name', val('%alice%'))  // name LIKE '%alice%'
 */
export function like(expr: ExprArg, pattern: ExprArg): Node {
  return {
    A_Expr: {
      kind: 'AEXPR_LIKE',
      name: [{ String: { sval: '~~' } }],
      lexpr: coerce(expr),
      rexpr: coerceRight(pattern),
    },
  };
}

/**
 * ILIKE operator (case-insensitive LIKE).
 *
 * @example
 * ilike('name', val('%alice%'))  // name ILIKE '%alice%'
 */
export function ilike(expr: ExprArg, pattern: ExprArg): Node {
  return {
    A_Expr: {
      kind: 'AEXPR_ILIKE',
      name: [{ String: { sval: '~~*' } }],
      lexpr: coerce(expr),
      rexpr: coerceRight(pattern),
    },
  };
}

// ── Range operators ─────────────────────────────────────────

/**
 * BETWEEN operator.
 *
 * @example
 * between('age', 18, 65)  // age BETWEEN 18 AND 65
 */
export function between(
  expr: ExprArg,
  low: ExprArg,
  high: ExprArg
): Node {
  return {
    A_Expr: {
      kind: 'AEXPR_BETWEEN',
      name: [{ String: { sval: 'BETWEEN' } }],
      lexpr: coerce(expr),
      rexpr: {
        List: {
          items: [coerceRight(low), coerceRight(high)],
        },
      },
    },
  };
}

/**
 * IN list operator.
 *
 * @example
 * inList('status', ['active', 'pending'])  // status IN ('active', 'pending')
 */
export function inList(
  expr: ExprArg,
  values: ExprArg[]
): Node {
  return {
    A_Expr: {
      kind: 'AEXPR_IN',
      name: [{ String: { sval: '=' } }],
      lexpr: coerce(expr),
      rexpr: {
        List: {
          items: values.map(coerceRight),
        },
      },
    },
  };
}

// ── Subquery operators ──────────────────────────────────────

/**
 * EXISTS subquery.
 *
 * @example
 * exists(select('id').from('users').where(eq('active', true)))
 */
export function exists(subquery: Node): Node {
  return {
    SubLink: {
      subLinkType: 'EXISTS_SUBLINK',
      subselect: subquery,
    },
  };
}

/**
 * IN subquery: `expr IN (SELECT ...)`.
 *
 * @example
 * inSubquery(col('user_id'), select('id').from('users'))
 */
export function inSubquery(expr: ExprArg, subquery: Node): Node {
  return {
    SubLink: {
      subLinkType: 'ANY_SUBLINK',
      testexpr: coerce(expr),
      operName: [{ String: { sval: '=' } }],
      subselect: subquery,
    },
  };
}

// ── Arithmetic operators ────────────────────────────────────

/** Addition: `left + right` */
export function add(left: ExprArg, right: ExprArg): Node {
  return aExpr('AEXPR_OP', '+', coerce(left), coerceRight(right));
}

/** Subtraction: `left - right` */
export function sub(left: ExprArg, right: ExprArg): Node {
  return aExpr('AEXPR_OP', '-', coerce(left), coerceRight(right));
}

/** Multiplication: `left * right` */
export function mul(left: ExprArg, right: ExprArg): Node {
  return aExpr('AEXPR_OP', '*', coerce(left), coerceRight(right));
}

/** Division: `left / right` */
export function div(left: ExprArg, right: ExprArg): Node {
  return aExpr('AEXPR_OP', '/', coerce(left), coerceRight(right));
}
