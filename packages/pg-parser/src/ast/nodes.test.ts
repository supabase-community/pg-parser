import { describe, expect, it } from 'vitest';
import {
  col,
  val,
  star,
  table,
  tableAlias,
  alias,
  func,
  param,
  cast,
  sort,
  coerce,
  coerceRight,
} from './nodes.js';

describe('col()', () => {
  it('creates unqualified column ref', () => {
    expect(col('id')).toMatchObject({
      ColumnRef: { fields: [{ String: { sval: 'id' } }] },
    });
  });

  it('creates qualified column ref', () => {
    expect(col('u', 'id')).toMatchObject({
      ColumnRef: {
        fields: [{ String: { sval: 'u' } }, { String: { sval: 'id' } }],
      },
    });
  });

  it('splits dotted string', () => {
    expect(col('u.id')).toMatchObject({
      ColumnRef: {
        fields: [{ String: { sval: 'u' } }, { String: { sval: 'id' } }],
      },
    });
  });
});

describe('val()', () => {
  it('creates string constant', () => {
    expect(val('hello')).toMatchObject({
      A_Const: { sval: { sval: 'hello' } },
    });
  });

  it('creates integer constant', () => {
    expect(val(42)).toMatchObject({
      A_Const: { ival: { ival: 42 } },
    });
  });

  it('creates float constant', () => {
    expect(val(3.14)).toMatchObject({
      A_Const: { fval: { fval: '3.14' } },
    });
  });

  it('creates boolean constant', () => {
    expect(val(true)).toMatchObject({
      A_Const: { boolval: { boolval: true } },
    });
  });

  it('creates NULL', () => {
    expect(val(null)).toMatchObject({
      A_Const: { isnull: true },
    });
  });
});

describe('star()', () => {
  it('creates A_Star', () => {
    expect(star()).toMatchObject({
      ColumnRef: { fields: [{ A_Star: {} }] },
    });
  });

  it('with table creates qualified star', () => {
    expect(star('users')).toMatchObject({
      ColumnRef: {
        fields: [{ String: { sval: 'users' } }, { A_Star: {} }],
      },
    });
  });
});

describe('table()', () => {
  it('creates RangeVar', () => {
    expect(table('users')).toMatchObject({
      RangeVar: { relname: 'users', inh: true, relpersistence: 'p' },
    });
  });

  it('with schema', () => {
    expect(table('users', 'public')).toMatchObject({
      RangeVar: { relname: 'users', schemaname: 'public' },
    });
  });
});

describe('tableAlias()', () => {
  it('creates aliased RangeVar', () => {
    expect(tableAlias('users', 'u')).toMatchObject({
      RangeVar: { relname: 'users', alias: { aliasname: 'u' } },
    });
  });
});

describe('alias()', () => {
  it('creates ResTarget with name', () => {
    expect(alias(col('name'), 'user_name')).toMatchObject({
      ResTarget: {
        name: 'user_name',
        val: { ColumnRef: { fields: [{ String: { sval: 'name' } }] } },
      },
    });
  });
});

describe('func()', () => {
  it('creates FuncCall', () => {
    expect(func('now')).toMatchObject({
      FuncCall: { funcname: [{ String: { sval: 'now' } }] },
    });
  });

  it('count(*) sets agg_star', () => {
    expect(func('count', star())).toMatchObject({
      FuncCall: {
        funcname: [{ String: { sval: 'count' } }],
        agg_star: true,
      },
    });
  });

  it('with args uses coerce', () => {
    const node = func('date_trunc', val('month'), col('created_at'));
    expect(node).toMatchObject({
      FuncCall: {
        funcname: [{ String: { sval: 'date_trunc' } }],
        args: [
          { A_Const: { sval: { sval: 'month' } } },
          { ColumnRef: { fields: [{ String: { sval: 'created_at' } }] } },
        ],
      },
    });
  });
});

describe('param()', () => {
  it('creates ParamRef', () => {
    expect(param(1)).toMatchObject({ ParamRef: { number: 1 } });
  });
});

describe('cast()', () => {
  it('creates TypeCast', () => {
    expect(cast(col('id'), 'text')).toMatchObject({
      TypeCast: {
        arg: { ColumnRef: {} },
        typeName: {
          names: [
            { String: { sval: 'pg_catalog' } },
            { String: { sval: 'text' } },
          ],
        },
      },
    });
  });
});

describe('sort()', () => {
  it('creates SortBy', () => {
    expect(sort(col('name'), 'desc')).toMatchObject({
      SortBy: { node: { ColumnRef: {} }, sortby_dir: 'SORTBY_DESC' },
    });
  });
});

describe('coerce()', () => {
  it('treats strings as columns', () => {
    expect(coerce('id')).toMatchObject({
      ColumnRef: { fields: [{ String: { sval: 'id' } }] },
    });
  });
});

describe('coerceRight()', () => {
  it('treats strings as values', () => {
    expect(coerceRight('hello')).toMatchObject({
      A_Const: { sval: { sval: 'hello' } },
    });
  });
});
