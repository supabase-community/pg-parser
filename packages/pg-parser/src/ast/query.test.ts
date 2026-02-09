import { describe, expect, it } from 'vitest';
import { PgParser } from '../pg-parser.js';
import { unwrapParseResult } from '../util.js';
import { AstQuery } from './query.js';
import { query, createAstTools } from './factory.js';
import { hasTable } from './predicates.js';
import { eq } from './expressions.js';
import { val } from './nodes.js';
import {
  SelectQuery,
  InsertQuery,
  CreateTableQuery,
} from './builders/index.js';

const pgParser = new PgParser();

async function parse(sql: string) {
  return unwrapParseResult(pgParser.parse(sql));
}

describe('AstQuery', () => {
  it('find returns detached builder', async () => {
    const tree = await parse('SELECT id FROM users');
    const q = query(tree);
    const sel = q.find('SelectStmt');
    expect(sel).toBeDefined();
  });

  it('findAll returns all matches', async () => {
    const tree = await parse('SELECT id FROM users; SELECT name FROM posts');
    const q = query(tree);
    const sels = q.findAll('SelectStmt');
    expect(sels.length).toBe(2);
  });

  it('has checks existence', async () => {
    const tree = await parse('SELECT id FROM users');
    const q = query(tree);
    expect(q.has('SelectStmt')).toBe(true);
    expect(q.has('DeleteStmt')).toBe(false);
  });

  it('has with predicate', async () => {
    const tree = await parse('SELECT id FROM users');
    const q = query(tree);
    expect(q.has('SelectStmt', hasTable('users'))).toBe(true);
    expect(q.has('SelectStmt', hasTable('posts'))).toBe(false);
  });

  it('transform modifies first match', async () => {
    const tree = await parse('SELECT id FROM users');
    const modified = query(tree).transform('RangeVar', (rv) =>
      rv.patch({ relname: 'accounts' })
    );
    const tables = modified.findAll('RangeVar');
    expect(tables[0]!.node.relname).toBe('accounts');
  });

  it('transformAll modifies all matches', async () => {
    const tree = await parse('SELECT id FROM users; SELECT name FROM posts');
    const modified = query(tree).transformAll('RangeVar', (rv) =>
      rv.patch({ relname: 'renamed' })
    );
    const tables = modified.findAll('RangeVar');
    for (const t of tables) {
      expect(t.node.relname).toBe('renamed');
    }
  });

  it('transform with predicate targets specific nodes', async () => {
    const tree = await parse('SELECT id FROM users, posts');
    const modified = query(tree).transform(
      'RangeVar',
      (node) => node.relname === 'users',
      (rv) => rv.patch({ relname: 'accounts' })
    );
    const tables = modified.findAll('RangeVar');
    const names = tables.map((t) => t.node.relname);
    expect(names).toContain('accounts');
    expect(names).toContain('posts');
    expect(names).not.toContain('users');
  });
});

describe('query() entry point', () => {
  it('wraps ParseResult', async () => {
    const tree = await parse('SELECT 1');
    const q = query(tree);
    expect(q).toBeInstanceOf(AstQuery);
  });

  it('detects SelectStmt', () => {
    expect(query({ targetList: [], op: 'SETOP_NONE' })).toBeInstanceOf(SelectQuery);
  });

  it('detects InsertStmt', () => {
    expect(query({ relation: { relname: 'users' }, cols: [] })).toBeInstanceOf(InsertQuery);
  });

  it('detects CreateStmt', () => {
    expect(query({ tableElts: [] })).toBeInstanceOf(CreateTableQuery);
  });
});

describe('createAstTools', () => {
  it('all builders share the same parser', async () => {
    const tools = createAstTools(pgParser);

    expect(await tools.select('id').from('users').toSQL()).toBe('SELECT id FROM users');

    expect(await tools.insert('users').columns('name').values('Alice').toSQL()).toBe(
      "INSERT INTO users (name) VALUES ('Alice')"
    );

    expect(
      await tools.update('users').set({ name: val('Bob') }).where(eq('id', 1)).toSQL()
    ).toBe("UPDATE users SET name = 'Bob' WHERE id = 1");

    expect(
      await tools.deleteFrom('sessions').where(eq('id', 1)).toSQL()
    ).toBe('DELETE FROM sessions WHERE id = 1');
  });

  it('query() wraps existing AST with parser bound', async () => {
    const tree = await parse('SELECT id FROM users');
    const tools = createAstTools(pgParser);
    const sql = await tools.query(tree).toSQL();
    expect(sql).toBe('SELECT id FROM users');
  });
});
