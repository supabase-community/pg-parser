import { describe, expect, it } from 'vitest';
import { PgParser } from '../../pg-parser.js';
import { unwrapParseResult } from '../../util.js';
import { createAstTools, query } from '../factory.js';
import {
  col, val, star, func, param, tableAlias,
} from '../nodes.js';
import {
  eq, gt, gte, lt, and, or, not, isNull, isNotNull,
  like, mul,
} from '../expressions.js';
import { hasTable } from '../predicates.js';

const pgParser = new PgParser();
const {
  select, insert, update, deleteFrom,
  createTable, alterTable, createIndex,
} = createAstTools(pgParser);

async function parse(sql: string) {
  return unwrapParseResult(pgParser.parse(sql));
}

describe('SelectQuery', () => {
  it('basic SELECT', async () => {
    expect(await select('id', 'name').from('users').toSQL()).toBe(
      'SELECT id, name FROM users'
    );
  });

  it('WHERE', async () => {
    expect(
      await select('id').from('users').where(eq('active', true)).toSQL()
    ).toBe('SELECT id FROM users WHERE active = true');
  });

  it('multiple WHERE ANDs', async () => {
    expect(
      await select('id')
        .from('users')
        .where(eq('active', true))
        .where(gt('age', 18))
        .toSQL()
    ).toContain('WHERE');
  });

  it('ORDER BY', async () => {
    expect(
      await select('id').from('users').orderBy('name', 'asc').toSQL()
    ).toBe('SELECT id FROM users ORDER BY name ASC');
  });

  it('ORDER BY DESC', async () => {
    expect(
      await select('id').from('users').orderBy('created_at', 'desc').toSQL()
    ).toBe('SELECT id FROM users ORDER BY created_at DESC');
  });

  it('LIMIT and OFFSET', async () => {
    expect(
      await select('id').from('users').limit(10).offset(20).toSQL()
    ).toBe('SELECT id FROM users LIMIT 10 OFFSET 20');
  });

  it('GROUP BY', async () => {
    expect(
      await select(func('count', star()), col('status'))
        .from('users')
        .groupBy('status')
        .toSQL()
    ).toBe('SELECT count(*), status FROM users GROUP BY status');
  });

  it('HAVING', async () => {
    expect(
      await select(func('count', star()), col('status'))
        .from('users')
        .groupBy('status')
        .having(gt(func('count', star()), 5))
        .toSQL()
    ).toBe(
      'SELECT count(*), status FROM users GROUP BY status HAVING count(*) > 5'
    );
  });

  it('DISTINCT', async () => {
    expect(await select('name').from('users').distinct().toSQL()).toBe(
      'SELECT DISTINCT name FROM users'
    );
  });

  it('JOIN', async () => {
    const sql = await select('u.id', 'p.title')
      .from(tableAlias('users', 'u'))
      .join(tableAlias('posts', 'p'), eq('u.id', col('p.user_id')))
      .toSQL();
    expect(sql).toBe(
      'SELECT u.id, p.title FROM users u JOIN posts p ON u.id = p.user_id'
    );
  });

  it('LEFT JOIN', async () => {
    const sql = await select('u.id')
      .from(tableAlias('users', 'u'))
      .leftJoin(tableAlias('posts', 'p'), eq('u.id', col('p.user_id')))
      .toSQL();
    expect(sql).toBe(
      'SELECT u.id FROM users u LEFT JOIN posts p ON u.id = p.user_id'
    );
  });

  it('parameters', async () => {
    const sql = await select('id', 'name')
      .from('users')
      .where(and(eq('tenant_id', param(1)), gte('created_at', param(2)))!)
      .limit(param(3))
      .toSQL();
    expect(sql).toBe(
      'SELECT id, name FROM users WHERE tenant_id = $1 AND created_at >= $2 LIMIT $3'
    );
  });

  it('CTE', async () => {
    const activeUsers = select('id', 'name')
      .from('users')
      .where(eq('active', true));

    const sql = await select(star())
      .with('active_users', activeUsers)
      .from('active_users')
      .toSQL();
    expect(sql).toBe(
      'WITH active_users AS (SELECT id, name FROM users WHERE active = true) SELECT * FROM active_users'
    );
  });

  it('UNION', async () => {
    const sql = await select('id').from('users').union(select('id').from('posts')).toSQL();
    expect(sql).toBe('SELECT id FROM users UNION SELECT id FROM posts');
  });

  it('FOR UPDATE', async () => {
    expect(await select('id').from('users').forUpdate().toSQL()).toBe(
      'SELECT id FROM users FOR UPDATE'
    );
  });
});

describe('InsertQuery', () => {
  it('basic INSERT', async () => {
    expect(
      await insert('users').columns('name', 'email').values('Alice', 'alice@example.com').toSQL()
    ).toBe("INSERT INTO users (name, email) VALUES ('Alice', 'alice@example.com')");
  });

  it('INSERT RETURNING', async () => {
    const sql = await insert('users')
      .columns('name')
      .values('Alice')
      .returning('id')
      .toSQL();
    expect(sql).toBe("INSERT INTO users (name) VALUES ('Alice') RETURNING id");
  });

  it('INSERT ON CONFLICT DO UPDATE', async () => {
    const sql = await insert('users')
      .columns('email', 'name')
      .values('alice@example.com', 'Alice')
      .onConflict({
        columns: ['email'],
        action: { set: { name: val('Alice') } },
      })
      .toSQL();
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO UPDATE');
  });

  it('INSERT ON CONFLICT DO NOTHING', async () => {
    const sql = await insert('users')
      .columns('email')
      .values('alice@example.com')
      .onConflict({ columns: ['email'], action: 'nothing' })
      .toSQL();
    expect(sql).toContain('ON CONFLICT');
    expect(sql).toContain('DO NOTHING');
  });
});

describe('UpdateQuery', () => {
  it('basic UPDATE', async () => {
    expect(
      await update('users').set({ name: val('Bob') }).where(eq('id', 1)).toSQL()
    ).toBe("UPDATE users SET name = 'Bob' WHERE id = 1");
  });

  it('UPDATE FROM', async () => {
    const sql = await update('products')
      .set({ price: mul(col('price'), 1.1) })
      .from('categories')
      .where(eq('products.category_id', col('categories.id')))
      .toSQL();
    expect(sql).toContain('FROM categories');
  });

  it('UPDATE RETURNING', async () => {
    const sql = await update('users')
      .set({ name: val('Bob') })
      .where(eq('id', 1))
      .returning('id', 'name')
      .toSQL();
    expect(sql).toContain('RETURNING');
  });
});

describe('DeleteQuery', () => {
  it('basic DELETE', async () => {
    expect(
      await deleteFrom('sessions').where(lt('expires_at', func('now'))).toSQL()
    ).toBe('DELETE FROM sessions WHERE expires_at < now()');
  });

  it('DELETE USING', async () => {
    const sql = await deleteFrom('posts')
      .using('users')
      .where(
        and(eq('posts.user_id', col('users.id')), eq('users.banned', true))!
      )
      .toSQL();
    expect(sql).toContain('USING users');
  });

  it('DELETE RETURNING', async () => {
    const sql = await deleteFrom('sessions')
      .where(lt('expires_at', func('now')))
      .returning('id')
      .toSQL();
    expect(sql).toContain('RETURNING');
  });
});

describe('CreateTableQuery', () => {
  it('basic CREATE TABLE', async () => {
    const sql = await createTable('users')
      .column('id', 'int8', (c) => c.primaryKey())
      .column('name', 'text', (c) => c.notNull())
      .column('email', 'text', (c) => c.unique())
      .toSQL();
    expect(sql).toContain('CREATE TABLE users');
    expect(sql).toContain('PRIMARY KEY');
    expect(sql).toContain('NOT NULL');
  });

  it('IF NOT EXISTS', async () => {
    const sql = await createTable('users')
      .column('id', 'int8')
      .ifNotExists()
      .toSQL();
    expect(sql).toContain('IF NOT EXISTS');
  });

  it('DEFAULT constraint', async () => {
    const sql = await createTable('users')
      .column('created_at', 'timestamptz', (c) => c.notNull().default(func('now')))
      .toSQL();
    expect(sql).toContain('DEFAULT now()');
    expect(sql).toContain('NOT NULL');
  });

  it('REFERENCES', async () => {
    const sql = await createTable('posts')
      .column('author_id', 'int8', (c) => c.notNull().references('users', 'id'))
      .toSQL();
    expect(sql).toContain('REFERENCES users');
  });

  it('table-level UNIQUE', async () => {
    const sql = await createTable('users')
      .column('name', 'text')
      .column('email', 'text')
      .unique('name', 'email')
      .toSQL();
    expect(sql).toContain('UNIQUE');
  });

  it('dropColumn', () => {
    const q = createTable('users')
      .column('id', 'int8')
      .column('temp', 'text')
      .dropColumn('temp');
    const cols = q.findAll('ColumnDef');
    expect(cols.length).toBe(1);
  });
});

describe('AlterTableQuery', () => {
  it('ADD COLUMN', async () => {
    const sql = await alterTable('users').addColumn('avatar_url', 'text').toSQL();
    expect(sql).toContain('ALTER TABLE');
    expect(sql).toContain('ADD COLUMN');
  });

  it('DROP COLUMN', async () => {
    const sql = await alterTable('users').dropColumn('temp').toSQL();
    expect(sql).toContain('DROP');
    expect(sql).toContain('temp');
  });
});

describe('CreateIndexQuery', () => {
  it('basic CREATE INDEX', async () => {
    const sql = await createIndex('idx_users_email')
      .on('users')
      .columns('email')
      .toSQL();
    expect(sql).toContain('CREATE INDEX');
    expect(sql).toContain('idx_users_email');
    expect(sql).toContain('ON users');
  });

  it('UNIQUE index', async () => {
    const sql = await createIndex('idx_users_email')
      .on('users')
      .columns('email')
      .unique()
      .toSQL();
    expect(sql).toContain('CREATE UNIQUE INDEX');
  });

  it('partial index with WHERE', async () => {
    const sql = await createIndex('idx_active_users')
      .on('users')
      .columns('email')
      .where(eq('active', true))
      .toSQL();
    expect(sql).toContain('WHERE');
  });

  it('CONCURRENTLY', async () => {
    const sql = await createIndex('idx_users_email')
      .on('users')
      .columns('email')
      .concurrently()
      .toSQL();
    expect(sql).toContain('CONCURRENTLY');
  });
});

describe('immutability', () => {
  it('SelectQuery.where does not mutate original', () => {
    const a = select('id').from('users');
    const b = a.where(eq('active', true));
    expect(a.node.whereClause).toBeUndefined();
    expect(b.node.whereClause).toBeDefined();
  });

  it('SelectQuery.limit does not mutate original', () => {
    const a = select('id').from('users');
    const b = a.limit(10);
    expect(a.node.limitCount).toBeUndefined();
    expect(b.node.limitCount).toBeDefined();
  });

  it('SelectQuery.orderBy does not mutate original', () => {
    const a = select('id').from('users');
    const b = a.orderBy('name', 'asc');
    expect(a.node.sortClause).toBeUndefined();
    expect(b.node.sortClause).toHaveLength(1);
  });

  it('SelectQuery.from does not mutate original', () => {
    const a = select('id');
    const b = a.from('users');
    expect(a.node.fromClause).toBeUndefined();
    expect(b.node.fromClause).toHaveLength(1);
  });

  it('UpdateQuery.set does not mutate original', () => {
    const a = update('users');
    const b = a.set({ name: val('Bob') });
    expect(a.node.targetList).toBeUndefined();
    expect(b.node.targetList).toHaveLength(1);
  });

  it('UpdateQuery.where does not mutate original', () => {
    const a = update('users').set({ name: val('Bob') });
    const b = a.where(eq('id', 1));
    expect(a.node.whereClause).toBeUndefined();
    expect(b.node.whereClause).toBeDefined();
  });

  it('DeleteQuery.where does not mutate original', () => {
    const a = deleteFrom('sessions');
    const b = a.where(eq('id', 1));
    expect(a.node.whereClause).toBeUndefined();
    expect(b.node.whereClause).toBeDefined();
  });

  it('InsertQuery.columns does not mutate original', () => {
    const a = insert('users');
    const b = a.columns('name', 'email');
    expect(a.node.cols).toBeUndefined();
    expect(b.node.cols).toHaveLength(2);
  });

  it('CreateTableQuery.column does not mutate original', () => {
    const a = createTable('users').column('id', 'int8');
    const b = a.column('name', 'text');
    expect(a.findAll('ColumnDef')).toHaveLength(1);
    expect(b.findAll('ColumnDef')).toHaveLength(2);
  });

  it('CreateIndexQuery.unique does not mutate original', () => {
    const a = createIndex('idx').on('users').columns('email');
    const b = a.unique();
    expect(a.node.unique).toBeFalsy();
    expect(b.node.unique).toBe(true);
  });

  it('AlterTableQuery.addColumn does not mutate original', () => {
    const a = alterTable('users');
    const b = a.addColumn('avatar_url', 'text');
    expect(a.node.cmds).toHaveLength(0);
    expect(b.node.cmds).toHaveLength(1);
  });

  it('chained calls produce independent snapshots', async () => {
    const base = select('id').from('users');
    const withWhere = base.where(eq('active', true));
    const withLimit = base.limit(10);
    const withBoth = base.where(eq('active', true)).limit(10);

    expect(await base.toSQL()).toBe('SELECT id FROM users');
    expect(await withWhere.toSQL()).toBe('SELECT id FROM users WHERE active = true');
    expect(await withLimit.toSQL()).toBe('SELECT id FROM users LIMIT 10');
    expect(await withBoth.toSQL()).toContain('WHERE');
    expect(await withBoth.toSQL()).toContain('LIMIT');
  });
});

describe('ColumnBuilder immutability', () => {
  // Import ColumnBuilder directly for unit testing
  it('notNull returns new instance', async () => {
    const a = createTable('t').column('x', 'text', (c) => c.notNull());
    const b = createTable('t').column('x', 'text');
    const aConstraints = a.findAll('ColumnDef')[0]!.node.constraints;
    const bConstraints = b.findAll('ColumnDef')[0]!.node.constraints;
    expect(aConstraints).toHaveLength(1);
    expect(bConstraints).toBeUndefined();
  });

  it('chaining produces cumulative constraints', async () => {
    const sql = await createTable('t')
      .column('x', 'text', (c) => c.notNull().unique().default(val('hi')))
      .toSQL();
    expect(sql).toContain('NOT NULL');
    expect(sql).toContain('UNIQUE');
    expect(sql).toContain('DEFAULT');
  });

  it('branching from same ColumnBuilder produces independent results', () => {
    // This tests that ColumnBuilder is truly immutable —
    // calling notNull() on a base doesn't affect a parallel unique() call
    const results: { a: number; b: number } = { a: 0, b: 0 };

    createTable('t').column('x', 'text', (c) => {
      const withNotNull = c.notNull();
      const withUnique = c.unique();
      results.a = withNotNull._constraints.length;
      results.b = withUnique._constraints.length;
      return withNotNull;
    });

    expect(results.a).toBe(1);
    expect(results.b).toBe(1);
  });
});

describe('lambda forms', () => {
  it('SelectQuery.where lambda replaces clause', async () => {
    const sql = await select('id')
      .from('users')
      .where(eq('active', true))
      .where((existing) => or(existing, eq('role', val('admin')))!)
      .toSQL();
    expect(sql).toContain('OR');
  });

  it('SelectQuery.from lambda replaces array', async () => {
    const sql = await select('id')
      .from('users')
      .from('posts')
      .from((existing) => existing.slice(0, 1))
      .toSQL();
    expect(sql).toContain('users');
    expect(sql).not.toContain('posts');
  });

  it('SelectQuery.orderBy lambda replaces array', async () => {
    const sql = await select('id')
      .from('users')
      .orderBy('name', 'asc')
      .orderBy('email', 'desc')
      .orderBy(() => [])
      .toSQL();
    expect(sql).not.toContain('ORDER BY');
  });

  it('SelectQuery.limit lambda modifies existing', async () => {
    const q = select('id').from('users').limit(10);
    // Lambda receives existing limit node
    const q2 = q.limit((existing) => {
      expect(existing).toBeDefined();
      return { A_Const: { ival: { ival: 20 } } };
    });
    expect(await q2.toSQL()).toContain('LIMIT 20');
  });

  it('SelectQuery.groupBy lambda replaces array', async () => {
    const sql = await select(func('count', star()), col('status'))
      .from('users')
      .groupBy('status')
      .groupBy(() => [col('role')])
      .toSQL();
    expect(sql).not.toContain('GROUP BY status');
    expect(sql).toContain('GROUP BY role');
  });

  it('SelectQuery.having lambda replaces clause', async () => {
    const sql = await select(func('count', star()))
      .from('users')
      .groupBy('status')
      .having(gt(func('count', star()), 5))
      .having(() => gt(func('count', star()), 10))
      .toSQL();
    expect(sql).toContain('HAVING count(*) > 10');
  });

  it('SelectQuery.returning lambda replaces targetList', async () => {
    const q = select('id', 'name').from('users');
    const q2 = q.returning((existing) =>
      existing.filter(
        (t) =>
          'ResTarget' in t &&
          (t as { ResTarget: { val?: { ColumnRef?: { fields?: unknown[] } } } })
            .ResTarget.val?.ColumnRef?.fields?.some(
              (f) => f !== null && typeof f === 'object' && 'String' in f &&
                (f as { String: { sval?: string } }).String.sval === 'id'
            )
      )
    );
    const targets = q2.node.targetList ?? [];
    expect(targets).toHaveLength(1);
  });

  it('UpdateQuery.set lambda replaces targetList', async () => {
    const sql = await update('users')
      .set({ name: val('Bob'), email: val('bob@example.com') })
      .set((existing) => existing.slice(0, 1))
      .where(eq('id', 1))
      .toSQL();
    expect(sql).toContain('name');
    expect(sql).not.toContain('email');
  });

  it('SelectQuery.offset lambda modifies existing', async () => {
    const q = select('id').from('users').offset(10);
    const q2 = q.offset((existing) => {
      expect(existing).toBeDefined();
      return { A_Const: { ival: { ival: 50 } } };
    });
    expect(await q2.toSQL()).toContain('OFFSET 50');
  });
});

describe('roundtrip: parse → modify → deparse', () => {
  it('adds WHERE to existing SELECT', async () => {
    const tree = await parse('SELECT id FROM users');
    const modified = query(tree, pgParser).transform('SelectStmt', (sq) =>
      sq.where(eq('active', true))
    );
    expect(await modified.toSQL()).toBe('SELECT id FROM users WHERE active = true');
  });

  it('renames tables across query', async () => {
    const tree = await parse(
      'SELECT u.id FROM users u JOIN posts p ON u.id = p.user_id'
    );
    const renames: Record<string, string> = { users: 'accounts', posts: 'articles' };
    const sql = await query(tree, pgParser)
      .transformAll('RangeVar', (rv) => {
        const relname = rv.node.relname;
        return relname && renames[relname]
          ? rv.patch({ relname: renames[relname] })
          : rv;
      })
      .toSQL();
    expect(sql).toContain('accounts');
    expect(sql).toContain('articles');
    expect(sql).not.toContain(' users');
    expect(sql).not.toContain(' posts');
  });

  it('adds tenant filter to all SELECTs', async () => {
    const tree = await parse('SELECT id FROM users; SELECT id FROM posts');
    const sql = await query(tree, pgParser)
      .transformAll('SelectStmt', (sq) =>
        sq.where(eq('tenant_id', param(1)))
      )
      .toSQL();
    const matches = sql.match(/tenant_id = \$1/g);
    expect(matches?.length).toBe(2);
  });

  it('transform with predicate targets specific statement', async () => {
    const tree = await parse('SELECT id FROM users; SELECT id FROM posts');
    const sql = await query(tree, pgParser)
      .transform(
        'SelectStmt',
        hasTable('users'),
        (sq) => sq.where(eq('active', true))
      )
      .toSQL();
    expect(sql).toContain('users WHERE active = true');
  });
});
