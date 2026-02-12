/// <reference path="../test/types/sql.d.ts" />

import { stripIndent } from 'common-tags';
import { describe, expect, it } from 'vitest';
import { PgParser } from './pg-parser.js';
import type { ParseResult } from './types/index.js';
import {
  assertAndUnwrapNode,
  assertDefined,
  isParseResultVersion,
  unwrapParseResult,
  unwrapDeparseResult,
} from './util.js';

import sqlDump from '../test/fixtures/dump.sql';

describe('parser', () => {
  it('defaults to v17', async () => {
    const pgParser = new PgParser();
    const result = await unwrapParseResult(pgParser.parse('SELECT 1+1 as sum'));
    expect(result.version).toBe(170004);
  });

  it('throws error for unsupported version', async () => {
    const create = () => new PgParser({ version: 13 as any });
    expect(create).toThrow('unsupported version');
  });

  it('narrows type using isParseResultVersion', async () => {
    const pgParser = new PgParser({ version: 17 as number });

    const result = await unwrapParseResult(pgParser.parse('SELECT 1+1 as sum'));

    if (isParseResultVersion(result, 17)) {
      const version17Result: ParseResult<17> = result;
      expect(version17Result.version).toBe(170004);
    } else {
      throw new Error('result is not version 17');
    }
  });
});

describe.each([15, 16, 17])('parser (v%i)', (version) => {
  const pgParser = new PgParser({ version }) as PgParser;

  it('parses sql into ast', async () => {
    const result = await unwrapParseResult(
      pgParser.parse('SELECT 1+1 as sum'),
    );
    expect(result).toMatchObject({
      stmts: [
        {
          stmt: {
            SelectStmt: {
              targetList: [
                {
                  ResTarget: {
                    name: 'sum',
                    val: {
                      A_Expr: {
                        kind: 'AEXPR_OP',
                        lexpr: { A_Const: { ival: { ival: 1 } } },
                        name: [{ String: { sval: '+' } }],
                        rexpr: { A_Const: { ival: { ival: 1 } } },
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      ],
    });
  });

  it('walks the parse tree with type narrowing', async () => {
    const result = await unwrapParseResult(
      pgParser.parse('SELECT 1+1 as sum'),
    );

    assertDefined(result.stmts, 'stmts not found');

    const [firstStmt] = result.stmts;
    assertDefined(firstStmt, 'stmts are empty');
    assertDefined(firstStmt.stmt, 'stmt not found');

    const selectStmt = assertAndUnwrapNode(firstStmt.stmt, 'SelectStmt');
    assertDefined(selectStmt.targetList, 'targetList not found');

    const [firstTarget] = selectStmt.targetList;
    assertDefined(firstTarget, 'targetList is empty');

    const resTarget = assertAndUnwrapNode(firstTarget, 'ResTarget');
    expect(resTarget.name).toBe('sum');
    assertDefined(resTarget.val, 'val not found');

    const aExpr = assertAndUnwrapNode(resTarget.val, 'A_Expr');
    expect(aExpr.kind).toBe('AEXPR_OP');
    assertDefined(aExpr.name, 'name not found');

    const [firstName] = aExpr.name;
    assertDefined(firstName, 'expression name is empty');

    const name = assertAndUnwrapNode(firstName, 'String');
    expect(name.sval).toBe('+');

    assertDefined(aExpr.lexpr, 'left side of expression not found');
    const leftConst = assertAndUnwrapNode(aExpr.lexpr, 'A_Const');
    assertDefined(leftConst.ival, 'expected left side constant to be an integer');
    expect(leftConst.ival.ival).toBe(1);

    assertDefined(aExpr.rexpr, 'right side of expression not found');
    const rightConst = assertAndUnwrapNode(aExpr.rexpr, 'A_Const');
    assertDefined(rightConst.ival, 'expected right side constant to be an integer');
    expect(rightConst.ival.ival).toBe(1);
  });

  it('parses large sql', async () => {
    const result = await unwrapParseResult(pgParser.parse(sqlDump));

    assertDefined(result.stmts, 'stmts not found');
    expect(result.stmts.length).toBeGreaterThan(0);
  });

  it('throws error for invalid sql', async () => {
    const resultPromise = unwrapParseResult(pgParser.parse('my invalid sql'));
    await expect(resultPromise).rejects.toThrow(
      'syntax error at or near "my"',
    );
  });

  it('reports syntax errors', async () => {
    const result = await pgParser.parse('invalid sql statement');

    if (!result.error) {
      throw new Error('error not found');
    }

    expect(result.error.type).toBe('syntax');
  });

  it('reports semantic errors', async () => {
    const result = await pgParser.parse(
      'ALTER INDEX my_idx ALTER COLUMN 0 SET STATISTICS 1000;',
    );

    if (!result.error) {
      throw new Error('error not found');
    }

    expect(result.error.type).toBe('semantic');
  });

  it('uses zero-based position in error', async () => {
    const sql = 'SELECT my_column, FROM my_table;';
    const result = await pgParser.parse(sql);

    if (!result.error) {
      throw new Error('error not found');
    }

    const expectedPosition = sql.indexOf('FROM');
    expect(result.error.position).toBe(expectedPosition);
  });

  it('has correct error position across multiple statements', async () => {
    const sql = stripIndent`
      SELECT my_column
      FROM my_table_1
      WHERE my_column = 1;

      SELECT my_column,
      FROM my_table_2
      WHERE my_column = 1;
    `;

    const result = await pgParser.parse(sql);

    if (!result.error) {
      throw new Error('error not found');
    }

    const expectedPosition = sql.indexOf('FROM', sql.indexOf('my_table_1'));
    expect(result.error.position).toBe(expectedPosition);
  });
});

describe.each([15, 16, 17])('deparser (v%i)', (version) => {
  // Cast to PgParser (defaults to v17 types) to avoid union type explosion
  // when version is dynamic. Runtime behavior is tested for all versions.
  const pgParser = new PgParser({ version }) as PgParser;

  /**
   * Parses SQL, deparses the AST, and asserts the result matches expected output.
   * If no expected output is provided, asserts an identity roundtrip (output === input).
   */
  async function expectRoundtrip(input: string, expected?: string) {
    const parseResult = await unwrapParseResult(pgParser.parse(input));
    const sql = await unwrapDeparseResult(pgParser.deparse(parseResult));
    expect(sql).toBe(expected ?? input);
    return sql;
  }

  describe('select', () => {
    it.each([
      'SELECT 1 + 1 AS sum',
      'SELECT id, name FROM users WHERE id = 1',
      'SELECT u.id, p.title FROM users u JOIN posts p ON u.id = p.user_id',
      'SELECT u.id, p.title FROM users u LEFT JOIN posts p ON u.id = p.user_id',
      'SELECT id, name FROM users ORDER BY name ASC LIMIT 10 OFFSET 20',
      'SELECT DISTINCT name FROM users',
      'WITH active_users AS (SELECT id, name FROM users WHERE active = true) SELECT * FROM active_users',
      'SELECT id FROM users UNION SELECT id FROM admins',
      'SELECT id FROM users UNION ALL SELECT id FROM admins',
      'SELECT id FROM users INTERSECT SELECT id FROM admins',
      "SELECT CASE WHEN status = 1 THEN 'active' WHEN status = 2 THEN 'inactive' ELSE 'unknown' END AS label FROM users",
      "SELECT '2024-01-01'::date",
      'SELECT * FROM users WHERE id IN (1, 2, 3)',
      'SELECT * FROM users WHERE age BETWEEN 18 AND 65',
      "SELECT * FROM users WHERE name LIKE 'Jo%'",
      'SELECT * FROM users u WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)',
      "SELECT COALESCE(nickname, name, 'anonymous') FROM users",
      'SELECT * FROM users WHERE id = 1 FOR UPDATE',
      "SELECT 'café' AS name",
      "SELECT * FROM users WHERE name = '日本語テスト'",
      "SELECT '🚀' AS emoji",
    ])('roundtrips: %s', async (sql) => {
      await expectRoundtrip(sql);
    });

    it.each([
      [
        'SELECT department, COUNT(*) AS cnt FROM employees GROUP BY department HAVING COUNT(*) > 5',
        'SELECT department, count(*) AS cnt FROM employees GROUP BY department HAVING count(*) > 5',
      ],
      [
        'SELECT * FROM (SELECT id, name FROM users) AS sub',
        'SELECT * FROM (SELECT id, name FROM users) sub',
      ],
      [
        'SELECT id, ROW_NUMBER() OVER (PARTITION BY department ORDER BY salary DESC) AS rn FROM employees',
        'SELECT id, row_number() OVER (PARTITION BY department ORDER BY salary DESC) AS rn FROM employees',
      ],
      [
        'SELECT COUNT(*), SUM(amount), AVG(amount), MIN(amount), MAX(amount) FROM orders',
        'SELECT count(*), sum(amount), avg(amount), min(amount), max(amount) FROM orders',
      ],
    ])('normalizes: %s', async (input, expected) => {
      await expectRoundtrip(input, expected);
    });
  });

  describe('insert', () => {
    it.each([
      "INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')",
      "INSERT INTO users (name) VALUES ('Bob') RETURNING id",
      'INSERT INTO archive (id, name) SELECT id, name FROM users WHERE active = false',
    ])('roundtrips: %s', async (sql) => {
      await expectRoundtrip(sql);
    });

    it('normalizes EXCLUDED to lowercase', async () => {
      await expectRoundtrip(
        "INSERT INTO users (id, name) VALUES (1, 'Alice') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name",
        "INSERT INTO users (id, name) VALUES (1, 'Alice') ON CONFLICT (id) DO UPDATE SET name = excluded.name",
      );
    });
  });

  describe('update', () => {
    it.each([
      "UPDATE users SET name = 'Alice' WHERE id = 1",
      "UPDATE users SET name = 'Alice', email = 'alice@example.com' WHERE id = 1",
      "UPDATE users SET name = 'Alice' WHERE id = 1 RETURNING *",
      'UPDATE users SET department = d.name FROM departments d WHERE users.dept_id = d.id',
    ])('roundtrips: %s', async (sql) => {
      await expectRoundtrip(sql);
    });
  });

  describe('delete', () => {
    it.each([
      'DELETE FROM users WHERE id = 1',
      'DELETE FROM users WHERE id = 1 RETURNING *',
      'DELETE FROM orders USING users WHERE orders.user_id = users.id AND users.active = false',
    ])('roundtrips: %s', async (sql) => {
      await expectRoundtrip(sql);
    });
  });

  describe('DDL', () => {
    it.each([
      'CREATE TABLE users (id serial PRIMARY KEY, name text NOT NULL, email text UNIQUE)',
      "CREATE TABLE users (id serial PRIMARY KEY, name text DEFAULT 'anon', created_at timestamptz DEFAULT now())",
      'DROP TABLE IF EXISTS users CASCADE',
      'CREATE SCHEMA myapp',
      'CREATE VIEW active_users AS SELECT id, name FROM users WHERE active = true',
    ])('roundtrips: %s', async (sql) => {
      await expectRoundtrip(sql);
    });

    it.each([
      [
        'CREATE TABLE posts (id serial PRIMARY KEY, user_id integer REFERENCES users (id))',
        'CREATE TABLE posts (id serial PRIMARY KEY, user_id int REFERENCES users (id))',
      ],
      [
        'CREATE INDEX idx_users_name ON users (name)',
        'CREATE INDEX idx_users_name ON users USING btree (name)',
      ],
      [
        'CREATE UNIQUE INDEX idx_users_email ON users (email)',
        'CREATE UNIQUE INDEX idx_users_email ON users USING btree (email)',
      ],
      [
        'ALTER TABLE users ADD COLUMN age integer',
        'ALTER TABLE users ADD COLUMN age int',
      ],
      ['ALTER TABLE users DROP COLUMN age', 'ALTER TABLE users DROP age'],
    ])('normalizes: %s', async (input, expected) => {
      await expectRoundtrip(input, expected);
    });
  });

  describe('multiple statements', () => {
    it('roundtrips multiple statements', async () => {
      await expectRoundtrip(
        "INSERT INTO users (name) VALUES ('Alice'); SELECT * FROM users",
      );
    });
  });

  describe('AST manipulation', () => {
    it('renames a column alias', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT 1 + 1 AS sum'),
      );

      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const resTarget = assertAndUnwrapNode(
        selectStmt.targetList![0]!,
        'ResTarget',
      );
      resTarget.name = 'total';

      const sql = await unwrapDeparseResult(pgParser.deparse(parseResult));
      expect(sql).toBe('SELECT 1 + 1 AS total');
    });

    it('adds a column to a select', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT id FROM users'),
      );

      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );

      selectStmt.targetList!.push({
        ResTarget: {
          name: 'email',
          val: { ColumnRef: { fields: [{ String: { sval: 'email' } }] } },
        },
      } as any);

      const sql = await unwrapDeparseResult(pgParser.deparse(parseResult));
      expect(sql).toBe('SELECT id, email AS email FROM users');
    });

    it('changes a table name', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT * FROM users'),
      );

      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const rangeVar = assertAndUnwrapNode(
        selectStmt.fromClause![0]!,
        'RangeVar',
      );
      rangeVar.relname = 'accounts';

      const sql = await unwrapDeparseResult(pgParser.deparse(parseResult));
      expect(sql).toBe('SELECT * FROM accounts');
    });

    it('removes a where clause', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT * FROM users WHERE active = true'),
      );

      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      delete selectStmt.whereClause;

      const sql = await unwrapDeparseResult(pgParser.deparse(parseResult));
      expect(sql).toBe('SELECT * FROM users');
    });

    it('changes a constant value', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT * FROM users WHERE id = 1'),
      );

      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const aExpr = assertAndUnwrapNode(selectStmt.whereClause!, 'A_Expr');
      const rConst = assertAndUnwrapNode(aExpr.rexpr!, 'A_Const');
      rConst.ival = { ival: 42 };

      const sql = await unwrapDeparseResult(pgParser.deparse(parseResult));
      expect(sql).toBe('SELECT * FROM users WHERE id = 42');
    });
  });

  describe('large sql', () => {
    it('roundtrips a large sql dump', async () => {
      const parseResult = await unwrapParseResult(pgParser.parse(sqlDump));

      assertDefined(parseResult.stmts, 'stmts not found');
      expect(parseResult.stmts.length).toBeGreaterThan(0);

      const sql = await unwrapDeparseResult(pgParser.deparse(parseResult));

      // Verify the deparsed output re-parses successfully with the same number of statements
      const reparseResult = await unwrapParseResult(pgParser.parse(sql));
      assertDefined(reparseResult.stmts, 'reparsed stmts not found');
      expect(reparseResult.stmts.length).toBe(parseResult.stmts.length);
    });
  });

  describe('roundtrip stability', () => {
    it('double roundtrip produces stable output', async () => {
      const input =
        'SELECT u.id, p.title FROM users u LEFT JOIN posts p ON u.id = p.user_id WHERE u.active = true ORDER BY u.id';
      const first = await expectRoundtrip(input);
      const second = await expectRoundtrip(first);
      expect(second).toBe(first);
    });
  });

  describe('per-node deparse', () => {
    it('deparses a statement node extracted from a parse result', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT id, name FROM users WHERE active = true'),
      );
      const stmt = parseResult.stmts![0]!.stmt!;
      const sql = await unwrapDeparseResult(pgParser.deparse(stmt));
      expect(sql).toBe('SELECT id, name FROM users WHERE active = true');
    });

    it('deparses a hand-built SelectStmt node', async () => {
      const node = {
        SelectStmt: {
          targetList: [
            {
              ResTarget: {
                val: {
                  ColumnRef: { fields: [{ String: { sval: 'id' } }] },
                },
              },
            },
          ],
          fromClause: [
            {
              RangeVar: { relname: 'users', inh: true, relpersistence: 'p' },
            },
          ],
          limitOption: 'LIMIT_OPTION_DEFAULT',
          op: 'SETOP_NONE',
        },
      };
      const sql = await unwrapDeparseResult(pgParser.deparse(node as any));
      expect(sql).toBe('SELECT id FROM users');
    });

    it('deparses an expression node (A_Expr)', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT 1 + 1'),
      );
      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const resTarget = assertAndUnwrapNode(
        selectStmt.targetList![0]!,
        'ResTarget',
      );
      const sql = await unwrapDeparseResult(
        pgParser.deparse(resTarget.val!),
      );
      expect(sql).toBe('1 + 1');
    });

    it('deparses a ColumnRef node', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT u.name FROM users u'),
      );
      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const resTarget = assertAndUnwrapNode(
        selectStmt.targetList![0]!,
        'ResTarget',
      );
      const sql = await unwrapDeparseResult(
        pgParser.deparse(resTarget.val!),
      );
      expect(sql).toBe('u.name');
    });

    it('deparses a FuncCall node', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT count(*) FROM users'),
      );
      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const resTarget = assertAndUnwrapNode(
        selectStmt.targetList![0]!,
        'ResTarget',
      );
      const sql = await unwrapDeparseResult(
        pgParser.deparse(resTarget.val!),
      );
      expect(sql).toBe('count(*)');
    });

    it('deparses a TypeName node', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse("SELECT '2024-01-01'::date"),
      );
      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const resTarget = assertAndUnwrapNode(
        selectStmt.targetList![0]!,
        'ResTarget',
      );
      const typeCast = assertAndUnwrapNode(resTarget.val!, 'TypeCast');
      const sql = await unwrapDeparseResult(
        pgParser.deparse({ TypeName: typeCast.typeName! } as any),
      );
      expect(sql).toBe('date');
    });

    it('deparses a RangeVar node', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT * FROM my_schema.my_table'),
      );
      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const sql = await unwrapDeparseResult(
        pgParser.deparse(selectStmt.fromClause![0]!),
      );
      expect(sql).toBe('my_schema.my_table');
    });

    it('deparses a ResTarget node (val + alias)', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT 1 + 1 AS total'),
      );
      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const sql = await unwrapDeparseResult(
        pgParser.deparse(selectStmt.targetList![0]!),
      );
      expect(sql).toBe('1 + 1 AS total');
    });

    it('deparses a non-SELECT statement node (InsertStmt)', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse("INSERT INTO users (name) VALUES ('Alice')"),
      );
      const stmt = parseResult.stmts![0]!.stmt!;
      const sql = await unwrapDeparseResult(pgParser.deparse(stmt));
      expect(sql).toBe("INSERT INTO users (name) VALUES ('Alice')");
    });

    it('deparses a DDL statement node (CreateStmt)', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse(
          'CREATE TABLE users (id serial PRIMARY KEY, name text NOT NULL)',
        ),
      );
      const stmt = parseResult.stmts![0]!.stmt!;
      const sql = await unwrapDeparseResult(pgParser.deparse(stmt));
      expect(sql).toBe(
        'CREATE TABLE users (id serial PRIMARY KEY, name text NOT NULL)',
      );
    });

    it('deparses a BoolExpr node', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT * FROM users WHERE active = true AND age > 18'),
      );
      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const sql = await unwrapDeparseResult(
        pgParser.deparse(selectStmt.whereClause!),
      );
      expect(sql).toBe('active = true AND age > 18');
    });

    it('deparses a TypeCast expression node', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse("SELECT '2024-01-01'::date"),
      );
      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const resTarget = assertAndUnwrapNode(
        selectStmt.targetList![0]!,
        'ResTarget',
      );
      const sql = await unwrapDeparseResult(
        pgParser.deparse(resTarget.val!),
      );
      expect(sql).toBe("'2024-01-01'::date");
    });

    it('deparses a SortBy clause node', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT * FROM users ORDER BY name DESC'),
      );
      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const sql = await unwrapDeparseResult(
        pgParser.deparse(selectStmt.sortClause![0]!),
      );
      expect(sql).toBe('name DESC');
    });

    it('deparses a ParamRef node', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT $1'),
      );
      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const resTarget = assertAndUnwrapNode(
        selectStmt.targetList![0]!,
        'ResTarget',
      );
      const sql = await unwrapDeparseResult(
        pgParser.deparse(resTarget.val!),
      );
      expect(sql).toBe('$1');
    });

    it('deparses a NullTest node', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT * FROM users WHERE name IS NOT NULL'),
      );
      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const sql = await unwrapDeparseResult(
        pgParser.deparse(selectStmt.whereClause!),
      );
      expect(sql).toBe('name IS NOT NULL');
    });

    it('deparses a SQLValueFunction node', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT CURRENT_TIMESTAMP'),
      );
      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const resTarget = assertAndUnwrapNode(
        selectStmt.targetList![0]!,
        'ResTarget',
      );
      const sql = await unwrapDeparseResult(
        pgParser.deparse(resTarget.val!),
      );
      expect(sql).toBe('current_timestamp');
    });

    it('deparses a MinMaxExpr node', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT GREATEST(1, 2, 3)'),
      );
      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const resTarget = assertAndUnwrapNode(
        selectStmt.targetList![0]!,
        'ResTarget',
      );
      const sql = await unwrapDeparseResult(
        pgParser.deparse(resTarget.val!),
      );
      expect(sql).toBe('GREATEST(1, 2, 3)');
    });

    it('deparses an A_ArrayExpr node', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT ARRAY[1, 2, 3]'),
      );
      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const resTarget = assertAndUnwrapNode(
        selectStmt.targetList![0]!,
        'ResTarget',
      );
      const sql = await unwrapDeparseResult(
        pgParser.deparse(resTarget.val!),
      );
      expect(sql).toBe('ARRAY[1, 2, 3]');
    });

    it('deparses a WHERE clause with IN subquery', async () => {
      const tree = await unwrapParseResult(
        pgParser.parse(
          'SELECT * FROM orders WHERE user_id IN (SELECT id FROM vip_users)',
        ),
      );
      const select = assertAndUnwrapNode(tree.stmts![0]!.stmt!, 'SelectStmt');
      const where = await unwrapDeparseResult(
        pgParser.deparse(select.whereClause!),
      );
      expect(where).toBe('user_id IN (SELECT id FROM vip_users)');

      // Drill deeper: extract and deparse just the subquery
      const subLink = assertAndUnwrapNode(select.whereClause!, 'SubLink');
      const subquery = await unwrapDeparseResult(
        pgParser.deparse(subLink.subselect!),
      );
      expect(subquery).toBe('SELECT id FROM vip_users');
    });

    it('deparses a WHERE clause and drills into each AND condition', async () => {
      const tree = await unwrapParseResult(
        pgParser.parse(
          'SELECT * FROM users WHERE active = true AND age > 18',
        ),
      );
      const select = assertAndUnwrapNode(
        tree.stmts![0]!.stmt!,
        'SelectStmt',
      );

      // Extract and deparse the WHERE clause
      const where = await unwrapDeparseResult(
        pgParser.deparse(select.whereClause!),
      );
      expect(where).toBe('active = true AND age > 18');

      // Drill deeper: extract each condition from the AND expression
      const bool = assertAndUnwrapNode(select.whereClause!, 'BoolExpr');
      const left = await unwrapDeparseResult(
        pgParser.deparse(bool.args![0]!),
      );
      const right = await unwrapDeparseResult(
        pgParser.deparse(bool.args![1]!),
      );
      expect(left).toBe('active = true');
      expect(right).toBe('age > 18');
    });

    it('deparses a SubLink node (EXISTS)', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse(
          'SELECT * FROM users u WHERE EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)',
        ),
      );
      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const sql = await unwrapDeparseResult(
        pgParser.deparse(selectStmt.whereClause!),
      );
      expect(sql).toBe(
        'EXISTS (SELECT 1 FROM orders o WHERE o.user_id = u.id)',
      );
    });

    it('deparses a CaseExpr node', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse(
          "SELECT CASE WHEN x = 1 THEN 'a' ELSE 'b' END FROM t",
        ),
      );
      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const resTarget = assertAndUnwrapNode(
        selectStmt.targetList![0]!,
        'ResTarget',
      );
      const sql = await unwrapDeparseResult(
        pgParser.deparse(resTarget.val!),
      );
      expect(sql).toBe("CASE WHEN x = 1 THEN 'a' ELSE 'b' END");
    });

    it('deparses a CoalesceExpr node', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse("SELECT COALESCE(name, 'unknown')"),
      );
      const selectStmt = assertAndUnwrapNode(
        parseResult.stmts![0]!.stmt!,
        'SelectStmt',
      );
      const resTarget = assertAndUnwrapNode(
        selectStmt.targetList![0]!,
        'ResTarget',
      );
      const sql = await unwrapDeparseResult(
        pgParser.deparse(resTarget.val!),
      );
      expect(sql).toBe("COALESCE(name, 'unknown')");
    });

    it('deparses a MERGE statement node', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse(
          'MERGE INTO target t USING source s ON t.id = s.id WHEN MATCHED THEN UPDATE SET val = s.val WHEN NOT MATCHED THEN INSERT (id, val) VALUES (s.id, s.val)',
        ),
      );
      const stmt = parseResult.stmts![0]!.stmt!;
      const sql = await unwrapDeparseResult(pgParser.deparse(stmt));
      expect(sql).toBe(
        'MERGE INTO target t USING source s ON t.id = s.id WHEN MATCHED THEN UPDATE SET val = s.val WHEN NOT MATCHED THEN INSERT (id, val) VALUES (s.id, s.val)',
      );
    });

    it('deparses a GRANT statement node', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('GRANT SELECT, INSERT ON users TO my_role'),
      );
      const stmt = parseResult.stmts![0]!.stmt!;
      const sql = await unwrapDeparseResult(pgParser.deparse(stmt));
      expect(sql).toBe('GRANT select, insert ON users TO my_role');
    });

    it('deparses a TRUNCATE statement node', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('TRUNCATE users'),
      );
      const stmt = parseResult.stmts![0]!.stmt!;
      const sql = await unwrapDeparseResult(pgParser.deparse(stmt));
      expect(sql).toBe('TRUNCATE users');
    });

    it('still deparses full ParseResult', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT 1'),
      );
      const sql = await unwrapDeparseResult(pgParser.deparse(parseResult));
      expect(sql).toBe('SELECT 1');
    });

    it('returns error for invalid node (wrong field type)', async () => {
      const result = await pgParser.deparse({
        SelectStmt: { targetList: 'not an array' },
      } as any);
      expect(result.error).toBeDefined();
      expect(result.error!.name).toBe('DeparseError');
    });

    it('returns error for unknown node type', async () => {
      const result = await pgParser.deparse({
        FakeNode: { foo: 'bar' },
      } as any);
      expect(result.error).toBeDefined();
      expect(result.error!.name).toBe('DeparseError');
    });

    it('deparses an A_Const node (integer)', async () => {
      const sql = await unwrapDeparseResult(
        pgParser.deparse({ A_Const: { ival: { ival: 42 } } } as any),
      );
      expect(sql).toBe('42');
    });

    it('deparses an A_Const node (string)', async () => {
      const sql = await unwrapDeparseResult(
        pgParser.deparse({ A_Const: { sval: { sval: 'hello' } } } as any),
      );
      expect(sql).toBe("'hello'");
    });

    it('returns error for empty object', async () => {
      const result = await pgParser.deparse({} as any);
      expect(result.error).toBeDefined();
      expect(result.error!.name).toBe('DeparseError');
    });

    it('does not leak memory during repeated per-node deparse', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT id, name FROM users'),
      );
      const stmt = parseResult.stmts![0]!.stmt!;

      // Warm up
      await unwrapDeparseResult(pgParser.deparse(stmt));

      const heapBefore = await pgParser.getHeapSize();

      for (let i = 0; i < 1000; i++) {
        await unwrapDeparseResult(pgParser.deparse(stmt));
      }

      const heapAfter = await pgParser.getHeapSize();
      expect(heapAfter - heapBefore).toBeLessThan(64 * 1024);
    });
  });

  describe('errors', () => {
    it('returns error when repeated field receives wrong type', async () => {
      const result = await pgParser.deparse({
        stmts: [{ stmt: { SelectStmt: { targetList: 'not an array' } } }],
      } as any);

      expect(result.error).toBeDefined();
      expect(result.error!.name).toBe('DeparseError');
      expect(result.error!.message).toContain('is not an array');
    });

    it('returns error when integer field receives wrong type', async () => {
      const result = await pgParser.deparse({
        version: 'not a number',
        stmts: [],
      } as any);

      expect(result.error).toBeDefined();
      expect(result.error!.name).toBe('DeparseError');
      expect(result.error!.message).toContain(
        'is not an integer required for GPB',
      );
    });

    it('returns error via unwrapDeparseResult for invalid AST', async () => {
      const resultPromise = unwrapDeparseResult(
        pgParser.deparse({
          stmts: [{ stmt: { SelectStmt: { targetList: 'not an array' } } }],
        } as any),
      );

      await expect(resultPromise).rejects.toThrow('is not an array');
    });
  });

  describe('memory', () => {
    it('does not leak memory during repeated parse operations', async () => {
      // Warm up (first parse may allocate lazy structures)
      await unwrapParseResult(pgParser.parse('SELECT 1'));

      const heapBefore = await pgParser.getHeapSize();

      for (let i = 0; i < 1000; i++) {
        await unwrapParseResult(pgParser.parse('SELECT 1'));
      }

      const heapAfter = await pgParser.getHeapSize();

      // Allow up to 1 WASM page (64 KB) of growth for internal allocator overhead
      expect(heapAfter - heapBefore).toBeLessThan(64 * 1024);
    });

    it('does not leak memory during repeated deparse operations', async () => {
      const parseResult = await unwrapParseResult(
        pgParser.parse('SELECT id, name FROM users WHERE active = true'),
      );

      // Warm up
      await unwrapDeparseResult(pgParser.deparse(parseResult));

      const heapBefore = await pgParser.getHeapSize();

      for (let i = 0; i < 1000; i++) {
        await unwrapDeparseResult(pgParser.deparse(parseResult));
      }

      const heapAfter = await pgParser.getHeapSize();

      // Allow up to 1 WASM page (64 KB) of growth for internal allocator overhead
      expect(heapAfter - heapBefore).toBeLessThan(64 * 1024);
    });

    it('does not leak memory during repeated roundtrip operations', async () => {
      const sql =
        'SELECT u.id, p.title FROM users u JOIN posts p ON u.id = p.user_id WHERE u.active = true';

      // Warm up
      const warmupResult = await unwrapParseResult(pgParser.parse(sql));
      await unwrapDeparseResult(pgParser.deparse(warmupResult));

      const heapBefore = await pgParser.getHeapSize();

      for (let i = 0; i < 1000; i++) {
        const parseResult = await unwrapParseResult(pgParser.parse(sql));
        await unwrapDeparseResult(pgParser.deparse(parseResult));
      }

      const heapAfter = await pgParser.getHeapSize();

      // Allow up to 1 WASM page (64 KB) of growth for internal allocator overhead
      expect(heapAfter - heapBefore).toBeLessThan(64 * 1024);
    });
  });
});
