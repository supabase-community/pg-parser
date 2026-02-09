import { describe, expect, it } from 'vitest';
import { PgParser } from '../pg-parser.js';
import { unwrapParseResult } from '../util.js';
import { rawFind, rawTransform, rawVisit } from './traverse.js';

const pgParser = new PgParser();

async function parse(sql: string) {
  return unwrapParseResult(pgParser.parse(sql));
}

describe('rawFind()', () => {
  it('finds nodes by type', async () => {
    const tree = await parse('SELECT id, name FROM users WHERE active = true');
    const columns = rawFind(tree, 'ColumnRef');
    expect(columns.length).toBeGreaterThanOrEqual(2);
  });

  it('with predicate filters results', async () => {
    const tree = await parse('SELECT id FROM users, posts');
    const results = rawFind<{ relname?: string }>(
      tree,
      'RangeVar',
      (rv) => rv.relname === 'users'
    );
    expect(results.length).toBe(1);
  });

  it('provides FindContext with path', async () => {
    const tree = await parse('SELECT id FROM users WHERE active = true');
    const cols = rawFind(tree, 'ColumnRef');
    expect(cols.length).toBeGreaterThan(0);
    expect(cols[0]!.ctx.path.length).toBeGreaterThan(0);
  });
});

describe('rawTransform()', () => {
  it('replaces nodes immutably', async () => {
    const tree = await parse('SELECT id FROM users');
    const transformed = rawTransform(
      tree,
      'RangeVar',
      (_wrapped, inner) => ({
        RangeVar: { ...(inner as Record<string, unknown>), relname: 'accounts' },
      }) as any
    );
    // Original unchanged
    const origTables = rawFind<{ relname?: string }>(tree, 'RangeVar');
    expect(origTables[0]!.node.relname).toBe('users');
    // Transformed has new name
    const newTables = rawFind<{ relname?: string }>(transformed, 'RangeVar');
    expect(newTables[0]!.node.relname).toBe('accounts');
  });
});

describe('rawVisit()', () => {
  it('visits all nodes of type', async () => {
    const tree = await parse('SELECT id, name FROM users WHERE active = true');
    const columns: unknown[] = [];
    rawVisit(tree, {
      ColumnRef: (node) => {
        columns.push(node);
      },
    });
    expect(columns.length).toBeGreaterThanOrEqual(2);
  });
});
