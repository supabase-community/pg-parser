import { describe, expect, it } from 'vitest';
import { PgParser } from '../pg-parser.js';
import { unwrapParseResult } from '../util.js';
import { rawFind } from './traverse.js';
import { hasTable, hasColumn, hasStar, inContext } from './predicates.js';

const pgParser = new PgParser();

async function parse(sql: string) {
  return unwrapParseResult(pgParser.parse(sql));
}

describe('hasTable()', () => {
  it('finds table in subtree', async () => {
    const tree = await parse('SELECT id FROM users');
    const stmts = rawFind(tree, 'SelectStmt');
    expect(hasTable('users')(stmts[0]!.node, stmts[0]!.ctx)).toBe(true);
    expect(hasTable('posts')(stmts[0]!.node, stmts[0]!.ctx)).toBe(false);
  });
});

describe('hasColumn()', () => {
  it('finds column in subtree', async () => {
    const tree = await parse('SELECT id, name FROM users');
    const stmts = rawFind(tree, 'SelectStmt');
    expect(hasColumn('id')(stmts[0]!.node, stmts[0]!.ctx)).toBe(true);
    expect(hasColumn('email')(stmts[0]!.node, stmts[0]!.ctx)).toBe(false);
  });
});

describe('hasStar', () => {
  it('detects SELECT *', async () => {
    const tree = await parse('SELECT * FROM users');
    const cols = rawFind(tree, 'ColumnRef');
    expect(cols.length).toBeGreaterThan(0);
    expect(hasStar(cols[0]!.node, cols[0]!.ctx)).toBe(true);
  });
});

describe('inContext()', () => {
  it('checks path ancestry', async () => {
    const tree = await parse('SELECT id FROM users WHERE active = true');
    const cols = rawFind(tree, 'ColumnRef');
    const whereCol = cols.find((c) => inContext('whereClause')(c.node, c.ctx));
    expect(whereCol).toBeDefined();
  });
});
