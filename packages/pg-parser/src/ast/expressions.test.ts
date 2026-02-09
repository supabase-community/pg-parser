import { describe, expect, it } from 'vitest';
import { col, val, table } from './nodes.js';
import {
  eq, neq, gt, gte, lt, lte,
  and, or, not,
  isNull, isNotNull,
  like, ilike,
  between, inList,
  exists,
  add, sub, mul, div,
} from './expressions.js';

describe('comparison ops', () => {
  it('eq', () => {
    expect(eq('name', 'Alice')).toMatchObject({
      A_Expr: {
        kind: 'AEXPR_OP',
        name: [{ String: { sval: '=' } }],
        lexpr: { ColumnRef: {} },
        rexpr: { A_Const: { sval: { sval: 'Alice' } } },
      },
    });
  });

  it('neq', () => {
    expect(neq('status', 'deleted')).toMatchObject({
      A_Expr: { name: [{ String: { sval: '<>' } }] },
    });
  });

  it('gt/gte/lt/lte', () => {
    expect(gt('age', 18)).toMatchObject({ A_Expr: { name: [{ String: { sval: '>' } }] } });
    expect(gte('age', 18)).toMatchObject({ A_Expr: { name: [{ String: { sval: '>=' } }] } });
    expect(lt('age', 65)).toMatchObject({ A_Expr: { name: [{ String: { sval: '<' } }] } });
    expect(lte('age', 100)).toMatchObject({ A_Expr: { name: [{ String: { sval: '<=' } }] } });
  });
});

describe('boolean ops', () => {
  it('and() combines expressions', () => {
    expect(and(eq('a', 1), eq('b', 2))).toMatchObject({
      BoolExpr: { boolop: 'AND_EXPR', args: [{}, {}] },
    });
  });

  it('and() skips undefined', () => {
    expect(and(undefined, eq('a', 1))).toMatchObject({
      A_Expr: { kind: 'AEXPR_OP' },
    });
  });

  it('and() returns undefined for all undefined', () => {
    expect(and(undefined, undefined)).toBeUndefined();
  });

  it('or() combines expressions', () => {
    expect(or(eq('a', 1), eq('b', 2))).toMatchObject({
      BoolExpr: { boolop: 'OR_EXPR' },
    });
  });

  it('not() negates', () => {
    expect(not(eq('a', 1))).toMatchObject({
      BoolExpr: { boolop: 'NOT_EXPR', args: [{}] },
    });
  });
});

describe('null tests', () => {
  it('isNull', () => {
    expect(isNull('deleted_at')).toMatchObject({
      NullTest: { nulltesttype: 'IS_NULL' },
    });
  });

  it('isNotNull', () => {
    expect(isNotNull('email')).toMatchObject({
      NullTest: { nulltesttype: 'IS_NOT_NULL' },
    });
  });
});

describe('pattern matching', () => {
  it('like', () => {
    expect(like('name', '%alice%')).toMatchObject({
      A_Expr: { kind: 'AEXPR_LIKE' },
    });
  });

  it('ilike', () => {
    expect(ilike('name', '%alice%')).toMatchObject({
      A_Expr: { kind: 'AEXPR_ILIKE' },
    });
  });
});

describe('range ops', () => {
  it('between', () => {
    expect(between('age', 18, 65)).toMatchObject({
      A_Expr: { kind: 'AEXPR_BETWEEN' },
    });
  });

  it('inList', () => {
    expect(inList('status', ['active', 'pending'])).toMatchObject({
      A_Expr: { kind: 'AEXPR_IN' },
    });
  });
});

describe('arithmetic', () => {
  it('add/sub/mul/div', () => {
    expect(add(col('a'), 1)).toMatchObject({ A_Expr: { name: [{ String: { sval: '+' } }] } });
    expect(sub(col('a'), 1)).toMatchObject({ A_Expr: { name: [{ String: { sval: '-' } }] } });
    expect(mul(col('price'), 1.1)).toMatchObject({ A_Expr: { name: [{ String: { sval: '*' } }] } });
    expect(div(col('total'), 2)).toMatchObject({ A_Expr: { name: [{ String: { sval: '/' } }] } });
  });
});

describe('sublinks', () => {
  it('exists', () => {
    const subq = {
      SelectStmt: {
        targetList: [{ ResTarget: { val: { A_Const: { ival: { ival: 1 } } } } }],
        fromClause: [table('users')],
      },
    };
    expect(exists(subq)).toMatchObject({
      SubLink: { subLinkType: 'EXISTS_SUBLINK' },
    });
  });
});
