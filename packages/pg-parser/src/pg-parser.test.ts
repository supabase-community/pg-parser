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

describe('demo', () => {
  it('demo', async () => {
    const pgParser = new PgParser();
    const result = await unwrapParseResult(
      pgParser.parse(
        'SELECT id, content FROM blog_posts ORDER BY created_at DESC'
      )
    );
    console.dir(result, { depth: null });
  });
});

describe('versions', () => {
  it('parses sql in v15', async () => {
    const pgParser = new PgParser({ version: 15 });
    const result = await unwrapParseResult(pgParser.parse('SELECT 1+1 as sum'));
    expect(result.version).toBe(150001);
  });

  it('parses sql in v16', async () => {
    const pgParser = new PgParser({ version: 16 });
    const result = await unwrapParseResult(pgParser.parse('SELECT 1+1 as sum'));
    expect(result.version).toBe(160001);
  });

  it('parses sql in v17', async () => {
    const pgParser = new PgParser({ version: 17 });
    const result = await unwrapParseResult(pgParser.parse('SELECT 1+1 as sum'));
    expect(result.version).toBe(170004);
  });

  it('parses sql in v17 by default', async () => {
    const pgParser = new PgParser();
    const result = await unwrapParseResult(pgParser.parse('SELECT 1+1 as sum'));
    expect(result.version).toBe(170004);
  });

  it('throws error for unsupported version', async () => {
    const create = () => new PgParser({ version: 13 as any });
    expect(create).toThrow('unsupported version');
  });

  it('parses large sql', async () => {
    const pgParser = new PgParser();
    const result = await unwrapParseResult(pgParser.parse(sqlDump));

    assertDefined(result.stmts, 'stmts not found');
    expect(result.stmts.length).toBeGreaterThan(0);
  });
});

describe('parser', () => {
  it('parses sql into ast', async () => {
    const pgParser = new PgParser();
    const result = await unwrapParseResult(pgParser.parse('SELECT 1+1 as sum'));
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

  it('parse result matches types', async () => {
    const pgParser = new PgParser();
    const result = await unwrapParseResult(pgParser.parse('SELECT 1+1 as sum'));

    expect(result.version).toBe(170004);

    // Use type narrowing to ensure the result is of the expected type
    // These should produce compile-time errors if the types are incorrect
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
    assertDefined(
      leftConst.ival,
      'expected left side constant to be an integer'
    );
    expect(leftConst.ival.ival).toBe(1);

    assertDefined(aExpr.rexpr, 'right side of expression not found');

    const rightConst = assertAndUnwrapNode(aExpr.rexpr, 'A_Const');
    assertDefined(
      rightConst.ival,
      'expected right side constant to be an integer'
    );
    expect(rightConst.ival.ival).toBe(1);
  });

  it('narrows type using isParseResultVersion', async () => {
    const pgParser = new PgParser({ version: 17 as number });

    const result = await unwrapParseResult(pgParser.parse('SELECT 1+1 as sum'));

    if (isParseResultVersion(result, 17)) {
      // The next statement will contain a type error if the version is not 17
      const version17Result: ParseResult<17> = result;
      expect(version17Result.version).toBe(170004);
    } else {
      throw new Error('result is not version 17');
    }
  });

  it('throws error for invalid sql', async () => {
    const pgParser = new PgParser();
    const resultPromise = unwrapParseResult(pgParser.parse('my invalid sql'));
    await expect(resultPromise).rejects.toThrow('syntax error at or near "my"');
  });

  it('throws an error when sql contains a syntax error', async () => {
    const pgParser = new PgParser();
    const result = await pgParser.parse(`invalid sql statement`);

    if (!result.error) {
      throw new Error('error not found');
    }

    expect(result.error.type).toBe('syntax');
  });

  it('throws an error when sql contains a semantic error', async () => {
    const pgParser = new PgParser();
    const result = await pgParser.parse(
      'ALTER INDEX my_idx ALTER COLUMN 0 SET STATISTICS 1000;'
    );

    if (!result.error) {
      throw new Error('error not found');
    }

    expect(result.error.type).toBe('semantic');
  });

  it('uses zero-based position in error', async () => {
    const sql = 'SELECT my_column, FROM my_table;';
    const pgParser = new PgParser();
    const result = await pgParser.parse(sql);

    if (!result.error) {
      throw new Error('error not found');
    }

    // Error will be at the start of "FROM"
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

    const pgParser = new PgParser();
    const result = await pgParser.parse(sql);

    if (!result.error) {
      throw new Error('error not found');
    }

    // Error will be at the start of the second "FROM" relative to the entire SQL string
    const expectedPosition = sql.indexOf('FROM', sql.indexOf('my_table_1'));
    expect(result.error.position).toBe(expectedPosition);
  });
});

describe('deparser', () => {
  it('deparses ast into sql', async () => {
    const pgParser = new PgParser();
    const parseResult = await unwrapParseResult(
      pgParser.parse('SELECT 1 + 1 AS sum')
    );

    const sql = await unwrapDeparseResult(pgParser.deparse(parseResult));

    expect(sql).toBe('SELECT 1 + 1 AS sum');
  });
});
