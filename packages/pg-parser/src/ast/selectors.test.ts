import { describe, expect, it } from 'vitest';
import { PgParser } from '../pg-parser.js';
import { unwrapParseResult } from '../util.js';
import { query } from './factory.js';
import { SelectQuery } from './builders/select.js';
import { CreateTableQuery } from './builders/create-table.js';
import { hasTable, hasColumn, hasStar, inContext } from './predicates.js';
import { eq } from './expressions.js';
import { param } from './nodes.js';

const pgParser = new PgParser();

async function parse(sql: string) {
  return unwrapParseResult(pgParser.parse(sql));
}

describe('find()', () => {
  it('returns typed builder for SelectStmt', async () => {
    const tree = await parse('SELECT id FROM users');
    const q = query(tree);
    const sel = q.find('SelectStmt');
    expect(sel).toBeInstanceOf(SelectQuery);
  });

  it('returns typed builder for CreateStmt', async () => {
    const tree = await parse('CREATE TABLE users (id int)');
    const q = query(tree);
    const ct = q.find('CreateStmt');
    expect(ct).toBeInstanceOf(CreateTableQuery);
  });

  it('returns undefined when not found', async () => {
    const tree = await parse('SELECT id FROM users');
    const q = query(tree);
    expect(q.find('DeleteStmt')).toBeUndefined();
  });

  it('with predicate filters matches', async () => {
    const tree = await parse('SELECT id FROM users; SELECT id FROM posts');
    const q = query(tree);
    const sel = q.find('SelectStmt', hasTable('posts'));
    expect(sel).toBeDefined();
    expect(sel!.has('RangeVar', (rv) => rv.relname === 'posts')).toBe(true);
  });

  it('returns first match only', async () => {
    const tree = await parse('SELECT id FROM users; SELECT name FROM posts');
    const q = query(tree);
    const sel = q.find('SelectStmt');
    // First select has 'id' column
    expect(sel!.has('ColumnRef', hasColumn('id'))).toBe(true);
  });
});

describe('findAll()', () => {
  it('returns all matches', async () => {
    const tree = await parse(
      'SELECT id FROM users; SELECT name FROM posts; DELETE FROM sessions',
    );
    const q = query(tree);
    expect(q.findAll('SelectStmt').length).toBe(2);
    expect(q.findAll('DeleteStmt').length).toBe(1);
    expect(q.findAll('InsertStmt').length).toBe(0);
  });

  it('with predicate filters', async () => {
    const tree = await parse('SELECT id FROM users; SELECT * FROM posts');
    const q = query(tree);
    const withStar = q.findAll('ColumnRef', hasStar);
    expect(withStar.length).toBe(1);
  });

  it('finds nodes in nested subtrees', async () => {
    const tree = await parse(
      'SELECT id FROM users WHERE id IN (SELECT user_id FROM active_users)',
    );
    const q = query(tree);
    // Should find both the outer and inner SelectStmt
    const selects = q.findAll('SelectStmt');
    expect(selects.length).toBe(2);
  });

  it('finds RangeVars across JOINs', async () => {
    const tree = await parse(
      'SELECT u.id FROM users u JOIN posts p ON u.id = p.user_id LEFT JOIN comments c ON p.id = c.post_id',
    );
    const q = query(tree);
    const tables = q.findAll('RangeVar');
    const names = tables.map((t) => t.node.relname);
    expect(names).toContain('users');
    expect(names).toContain('posts');
    expect(names).toContain('comments');
  });

  it('searches within a detached builder subtree', async () => {
    const tree = await parse('SELECT id FROM users WHERE active = true');
    const q = query(tree);
    const sel = q.find('SelectStmt')!;
    const cols = sel.findAll('ColumnRef');
    // id + active
    expect(cols.length).toBeGreaterThanOrEqual(2);
  });
});

describe('has()', () => {
  it('returns true when node exists', async () => {
    const tree = await parse('SELECT id FROM users');
    const q = query(tree);
    expect(q.has('SelectStmt')).toBe(true);
    expect(q.has('RangeVar')).toBe(true);
    expect(q.has('ColumnRef')).toBe(true);
  });

  it('returns false when node missing', async () => {
    const tree = await parse('SELECT id FROM users');
    const q = query(tree);
    expect(q.has('DeleteStmt')).toBe(false);
    expect(q.has('InsertStmt')).toBe(false);
  });

  it('with predicate helper', async () => {
    const tree = await parse('SELECT * FROM users');
    const q = query(tree);
    expect(q.has('ColumnRef', hasStar)).toBe(true);
    expect(q.has('SelectStmt', hasTable('users'))).toBe(true);
    expect(q.has('SelectStmt', hasTable('posts'))).toBe(false);
  });

  it('with inline predicate', async () => {
    const tree = await parse('SELECT id FROM users WHERE active = true');
    const q = query(tree);
    expect(
      q.has(
        'ColumnRef',
        (node) =>
          node.fields?.some(
            (f) =>
              'String' in f &&
              (f as { String: { sval?: string } }).String.sval === 'active',
          ) ?? false,
      ),
    ).toBe(true);
  });

  it('with inContext predicate', async () => {
    const tree = await parse('SELECT id FROM users WHERE active = true');
    const q = query(tree);
    const whereCols = q.findAll('ColumnRef', (_node, ctx) =>
      inContext('whereClause')(_node, ctx),
    );
    expect(whereCols.length).toBeGreaterThan(0);
    const selectCols = q.findAll('ColumnRef', (_node, ctx) =>
      inContext('targetList')(_node, ctx),
    );
    expect(selectCols.length).toBeGreaterThan(0);
  });
});

describe('transform()', () => {
  it('modifies first match, preserves rest', async () => {
    const tree = await parse('SELECT id FROM users; SELECT name FROM posts');
    const modified = query(tree, pgParser).transform('RangeVar', (rv) =>
      rv.patch({ relname: 'replaced' }),
    );
    const sql = await modified.toSQL();
    // Only the first RangeVar (users) should be replaced
    expect(sql).toContain('replaced');
    expect(sql).toContain('posts');
  });

  it('with predicate skips non-matching', async () => {
    const tree = await parse('SELECT id FROM users, posts, comments');
    const modified = query(tree, pgParser).transform(
      'RangeVar',
      (node) => node.relname === 'posts',
      (rv) => rv.patch({ relname: 'articles' }),
    );
    const sql = await modified.toSQL();
    expect(sql).toContain('users');
    expect(sql).toContain('articles');
    expect(sql).toContain('comments');
    expect(sql).not.toContain('posts');
  });

  it('produces immutable result (original unchanged)', async () => {
    const tree = await parse('SELECT id FROM users');
    const q = query(tree);
    const modified = q.transform('RangeVar', (rv) =>
      rv.patch({ relname: 'accounts' }),
    );
    // Original still has 'users'
    expect(q.find('RangeVar')!.node).toMatchObject({ relname: 'users' });
    // Modified has 'accounts'
    expect(modified.find('RangeVar')!.node).toMatchObject({
      relname: 'accounts',
    });
  });

  it('can chain builder methods in callback', async () => {
    const tree = await parse('SELECT id FROM users');
    const sql = await query(tree, pgParser)
      .transform('SelectStmt', (sq) => sq.where(eq('active', true)).limit(100))
      .toSQL();
    expect(sql).toContain('WHERE active = true');
    expect(sql).toContain('LIMIT 100');
  });
});

describe('transformAll()', () => {
  it('modifies all matches', async () => {
    const tree = await parse('SELECT id FROM users; SELECT name FROM posts');
    const modified = query(tree, pgParser).transformAll('RangeVar', (rv) =>
      rv.patch({ schemaname: 'tenant_1' }),
    );
    const sql = await modified.toSQL();
    // Both tables should be schema-qualified
    const matches = sql.match(/tenant_1\./g);
    expect(matches?.length).toBe(2);
  });

  it('with predicate filters which nodes to transform', async () => {
    const tree = await parse(
      'SELECT id FROM users; SELECT id FROM posts; SELECT id FROM comments',
    );
    const modified = query(tree, pgParser).transformAll(
      'SelectStmt',
      hasTable('users'),
      (sq) => sq.where(eq('tenant_id', param(1))),
    );
    const sql = await modified.toSQL();
    // Only the users SELECT should have the filter
    const matches = sql.match(/tenant_id = \$1/g);
    expect(matches?.length).toBe(1);
  });

  it('reaches nested subqueries', async () => {
    const tree = await parse(
      'SELECT id FROM users WHERE id IN (SELECT user_id FROM active_users)',
    );
    const renames: Record<string, string> = {
      users: 'accounts',
      active_users: 'active_accounts',
    };
    const sql = await query(tree, pgParser)
      .transformAll('RangeVar', (rv) => {
        const relname = rv.node.relname;
        return relname && renames[relname]
          ? rv.patch({ relname: renames[relname] })
          : rv;
      })
      .toSQL();
    expect(sql).toContain('accounts');
    expect(sql).toContain('active_accounts');
    expect(sql).not.toContain(' users');
  });

  it('reaches CTEs', async () => {
    const tree = await parse(`
      WITH active AS (SELECT id FROM users WHERE active = true)
      SELECT * FROM active
    `);
    const sql = await query(tree, pgParser)
      .transformAll('RangeVar', (rv) =>
        rv.node.relname === 'users' ? rv.patch({ relname: 'accounts' }) : rv,
      )
      .toSQL();
    expect(sql).toContain('accounts');
    expect(sql).not.toContain('users');
  });
});
