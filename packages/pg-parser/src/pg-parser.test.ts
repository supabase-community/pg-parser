import { stripIndent } from 'common-tags';
import { describe, expect, it } from 'vitest';
import { PgParser } from './pg-parser.js';
import type { ParseResult } from './types/index.js';
import { isParseResultVersion, unwrapParseResult } from './util.js';

describe('pg-parser', () => {
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

  it('throws error for unsupported version', async () => {
    const create = () => new PgParser({ version: 13 });
    expect(create).toThrow('unsupported version');
  });

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

    if (!result.stmts) {
      throw new Error('stmts not found');
    }

    const [firstStmt] = result.stmts;
    if (!firstStmt) {
      throw new Error('stmts are empty');
    }

    // Use type narrowing to ensure the result is of the expected type
    // These should produce compile-time errors if the types are incorrect
    if (!firstStmt.stmt) {
      throw new Error('stmt not found');
    }

    if (!('SelectStmt' in firstStmt.stmt) || !firstStmt.stmt.SelectStmt) {
      throw new Error('SelectStmt not found');
    }

    if (!('targetList' in firstStmt.stmt.SelectStmt)) {
      throw new Error('targetList not found');
    }

    if (!Array.isArray(firstStmt.stmt.SelectStmt.targetList)) {
      throw new Error('targetList is not an array');
    }

    const [firstTarget] = firstStmt.stmt.SelectStmt.targetList;
    if (!firstTarget) {
      throw new Error('targetList is empty');
    }

    if (!('ResTarget' in firstTarget) || !firstTarget.ResTarget) {
      throw new Error('ResTarget not found');
    }

    expect(firstTarget.ResTarget.name).toBe('sum');

    if (!firstTarget.ResTarget.val) {
      throw new Error('val not found');
    }

    if (
      !('A_Expr' in firstTarget.ResTarget.val) ||
      !firstTarget.ResTarget.val.A_Expr
    ) {
      throw new Error('A_Expr not found');
    }

    expect(firstTarget.ResTarget.val.A_Expr.kind).toBe('AEXPR_OP');

    if (!firstTarget.ResTarget.val.A_Expr.name) {
      throw new Error('name not found');
    }

    const [firstName] = firstTarget.ResTarget.val.A_Expr.name;

    if (!firstName) {
      throw new Error('expression name is empty');
    }

    if (!('String' in firstName) || !firstName.String) {
      throw new Error('expression name should be String');
    }

    expect(firstName.String.sval).toBe('+');

    if (!firstTarget.ResTarget.val.A_Expr.lexpr) {
      throw new Error('lexpr not found');
    }

    if (
      !('A_Const' in firstTarget.ResTarget.val.A_Expr.lexpr) ||
      !firstTarget.ResTarget.val.A_Expr.lexpr.A_Const
    ) {
      throw new Error('left side of expression should be A_Const');
    }

    if (!firstTarget.ResTarget.val.A_Expr.lexpr.A_Const.ival) {
      throw new Error('expected left side constant to be an integer');
    }

    expect(firstTarget.ResTarget.val.A_Expr.lexpr.A_Const.ival.ival).toBe(1);

    if (!firstTarget.ResTarget.val.A_Expr.rexpr) {
      throw new Error('rexpr not found');
    }

    if (
      !('A_Const' in firstTarget.ResTarget.val.A_Expr.rexpr) ||
      !firstTarget.ResTarget.val.A_Expr.rexpr.A_Const
    ) {
      throw new Error('right side of expression should be A_Const');
    }

    if (!firstTarget.ResTarget.val.A_Expr.rexpr.A_Const.ival) {
      throw new Error('expected right side constant to be an integer');
    }

    expect(firstTarget.ResTarget.val.A_Expr.rexpr.A_Const.ival.ival).toBe(1);
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
