# pg-parser AST Tools: Builder, Selector, Transform

## Setup

```typescript
import { PgParser } from 'pg-parser'
import {
  // Node factories (for when you need explicit control)
  col, val, star, table, tableAlias, alias, func, param, cast, sort, typeName, columnDef,
  // Expression helpers (strings auto-wrap as columns, primitives as values)
  eq, neq, gt, gte, lt, lte, and, or, not, isNull, isNotNull, like, ilike,
  between, inList, exists, inSubquery, add, sub, mul, div,
  // Traversal & selection
  find, findAll, transform, transformAll, visit,
  // Predicate helpers
  hasTable, hasColumn, hasStar, inContext,
  // Factory (binds parser so you don't pass it everywhere)
  createAstTools,
} from 'pg-parser/ast'

const parser = new PgParser()

// Bind parser once — gives you builders + query() with .toSQL() that just works
const { select, insert, update, deleteFrom, createTable, alterTable, createIndex, query } =
  createAstTools(parser)
```

### Auto-coercion rules for expression helpers

Expression helpers have **positional defaults** — left arg defaults to column, right arg defaults to value:
```typescript
eq('name', 'Alice')             // col('name') = val('Alice')
gt('age', 18)                   // col('age') > val(18)
like('email', '%@gmail%')       // col('email') LIKE val('%@gmail%')
eq('active', true)              // col('active') = val(true)
between('age', 18, 65)          // col('age') BETWEEN val(18) AND val(65)
inList('status', ['active', 'pending'])  // col('status') IN (val('active'), val('pending'))
isNull('deleted_at')            // col('deleted_at') IS NULL
```

Edge cases — use explicit `col()`/`val()` to override the defaults:
```typescript
eq('u.id', col('p.user_id'))   // column = column (join condition)
eq(val('hello'), val('world'))  // value = value (unusual but possible)
```

Dotted strings like `'u.id'` are split into qualified column refs: `col('u', 'id')`.

Summary: `string` on the left → `col()`. `string | number | boolean | null` on the right → `val()`. `Node` anywhere → passthrough.

---

## Real-World Scenarios

### 1. Build a REST API query with filters, pagination, sorting

```typescript
const query = select('id', 'name', 'email')
  .from('users')
  .where(
    and(
      eq('active', true),
      gte('created_at', val('2024-01-01')),
      or(
        like('name', val('%alice%')),
        like('email', val('%alice%')),
      ),
    ),
  )
  .orderBy('created_at', 'desc')
  .limit(20)
  .offset(40)

const sql = await query.toSQL()
// SELECT id, name, email FROM users
// WHERE active = true AND created_at >= '2024-01-01'
//   AND (name LIKE '%alice%' OR email LIKE '%alice%')
// ORDER BY created_at DESC LIMIT 20 OFFSET 40
```

### 2. Build a complex analytics query with JOINs, aggregation

```typescript
const query = select(
    func('date_trunc', val('month'), col('o', 'created_at')),
    func('sum', col('o', 'total')),
    func('count', star()),
  )
  .from(tableAlias('orders', 'o'))
  .leftJoin(tableAlias('users', 'u'), eq('o.user_id', 'u.id'))
  .where(
    and(
      gte('o.created_at', val('2024-01-01')),
      eq('u.active', true),
    ),
  )
  .groupBy(func('date_trunc', val('month'), col('o', 'created_at')))
  .having(gt(func('sum', col('o', 'total')), 1000))
  .orderBy(func('date_trunc', val('month'), col('o', 'created_at')), 'desc')

const sql = await query.toSQL()
```

### 3. Build an upsert (INSERT ... ON CONFLICT)

```typescript
const sql = await insert('users')
  .columns('email', 'name', 'updated_at')
  .values('alice@example.com', 'Alice', func('now'))
  .onConflict({
    columns: ['email'],
    action: {
      set: { name: val('Alice'), updated_at: func('now') },
    },
  })
  .returning('id', 'email')
  .toSQL()

// INSERT INTO users (email, name, updated_at)
// VALUES ('alice@example.com', 'Alice', now())
// ON CONFLICT (email) DO UPDATE SET name = 'Alice', updated_at = now()
// RETURNING id, email
```

### 4. Build an UPDATE with FROM

```typescript
const sql = await update('products')
  .set({
    price: mul(col('price'), 1.1),
    updated_at: func('now'),
  })
  .from('categories')
  .where(
    and(
      eq('products.category_id', 'categories.id'),
      eq('categories.name', val('Electronics')),
      lt('products.price', 100),
    ),
  )
  .returning('id', 'name', 'price')
  .toSQL()
```

### 5. Build a DELETE with a subquery

```typescript
const sql = await deleteFrom('sessions')
  .where(
    and(
      lt('expires_at', func('now')),
      not(inSubquery(
        col('user_id'),
        select('id').from('users').where(eq('is_admin', true)),
      )),
    ),
  )
  .toSQL()
```

### 6. Build a CREATE TABLE with constraints

```typescript
const sql = await createTable('posts')
  .column('id', 'bigint', c => c.primaryKey().default(func('generate_id')))
  .column('title', 'text', c => c.notNull())
  .column('body', 'text')
  .column('author_id', 'bigint', c => c.notNull().references('users', 'id'))
  .column('status', 'text', c => c.notNull().default(val('draft')))
  .column('published_at', 'timestamptz')
  .column('created_at', 'timestamptz', c => c.notNull().default(func('now')))
  .unique('title', 'author_id')
  .check(inList('status', [val('draft'), val('published'), val('archived')]))
  .ifNotExists()
  .toSQL()
```

### 7. Build a migration: ALTER TABLE + CREATE INDEX

```typescript
const migration = [
  alterTable('users')
    .addColumn('avatar_url', 'text')
    .addColumn('bio', 'text', c => c.default(val(''))),

  alterTable('users')
    .alterColumn('email', c => c.setNotNull()),

  createIndex('idx_users_email')
    .on('users')
    .columns('email')
    .unique()
    .where(isNotNull('email')),

  createIndex('idx_posts_author_status')
    .on('posts')
    .columns('author_id', 'status')
    .where(eq('status', val('published'))),
]

for (const stmt of migration) {
  console.log(await stmt.toSQL())
}
```

### 8. Core selectors — `find`, `findAll`, `transform`, `transformAll`, `has`

All 5 share the same targeting: `(type, predicate?)`. They differ in what they return.

| Method | Returns | Behavior |
|--------|---------|----------|
| `find(type, pred?)` | `BuilderFor<T> \| undefined` | First match, **detached** — for inspection |
| `findAll(type, pred?)` | `BuilderFor<T>[]` | All matches, **detached** — for inspection |
| `transform(type, pred?, fn)` | `AstQuery<T>` (same tree) | First match, **in context** — callback modifies, rest preserved |
| `transformAll(type, pred?, fn)` | `AstQuery<T>` (same tree) | All matches, **in context** — callback modifies each |
| `has(type, pred?)` | `boolean` | Existence check |

**Depth behavior: recursive by default.** All 5 walk the full AST depth-first — CTEs, subqueries, JOINs, nested expressions, everything. Use `inContext()` predicate or `ctx.path` to scope when needed.

**Detached vs in-context:**
- **Detached** (`find`/`findAll`): returns builder(s) you can inspect or chain (`.where()`, `.node`, etc.) but changes don't flow back to the original tree.
- **In-context** (`transform`/`transformAll`): callback receives the same typed builder, but the returned value replaces the node in a cloned tree. The rest of the tree is preserved.

```typescript
const ast = await unwrapParseResult(parser.parse(`
  SELECT u.id, u.name, p.title
  FROM users u
  JOIN posts p ON u.id = p.user_id
  WHERE p.published = true
  ORDER BY p.created_at DESC
`))

const q = query(ast)

// ── find: single, detached ─────────────────────────────────
const sq = q.find('SelectStmt')              // SelectQuery | undefined
sq?.node.targetList                          // read raw fields
sq?.findAll('ColumnRef')                     // search within subtree

// ── findAll: multiple, detached ─────────────────────────────
const allCols = q.findAll('ColumnRef')       // AstQuery<ColumnRef>[]
allCols.map(c => c.node)                     // extract raw nodes

// ── transform: single, in context ──────────────────────────
const modified = q.transform('SelectStmt', sq =>
  sq.where(eq('u.tenant_id', val('acme-corp')))
    .where(gte('u.created_at', val('2024-01-01')))
    .limit(100)
)
// → AstQuery<ParseResult> with the SelectStmt modified, rest of tree preserved

// ── transformAll: all matches, in context ───────────────────
// Add tenant filter to EVERY SelectStmt in the tree (including subqueries)
const tenanted = q.transformAll('SelectStmt', sq =>
  sq.where(eq('tenant_id', param(1)))
)

// ── has: boolean check ──────────────────────────────────────
q.has('DeleteStmt')                          // false
q.has('SelectStmt')                          // true
q.has('ColumnRef', hasStar)                  // false (no SELECT *)
```

**All 5 accept predicates for targeting:**
```typescript
// transform only the SELECT that touches 'users'
q.transform('SelectStmt', hasTable('users'), sq =>
  sq.where(eq('active', true))
)

// transformAll: add RLS filter to every SELECT with 'orders' table
q.transformAll('SelectStmt', hasTable('orders'), sq =>
  sq.where(eq('org_id', param(1)))
)

// find the DELETE without a WHERE
const unsafeDelete = q.find('DeleteStmt', node => !node.whereClause)

// has with predicate
q.has('SelectStmt', hasTable('users'))       // true
```

**Nested transforms — recursive by default:**
```typescript
// This reaches RangeVars at every depth: top-level, CTEs, JOINs, subqueries
q.transformAll('RangeVar', rv => {
  const { relname } = rv.node
  return relname === 'users' ? rv.set({ relname: 'accounts' }) : rv
})

// Scope to specific context with predicate
q.findAll('ColumnRef', (node, ctx) => inContext('whereClause')(node, ctx))
// → only ColumnRefs inside WHERE clauses, at any depth
```

### 9. Design principles

**Every chainable method supports lambda.** Value does the default thing, lambda receives existing and gives full control. Consistent mental model everywhere.

| Method type | Value form (default) | Lambda form (full control) |
|-------------|---------------------|---------------------------|
| Single clause (`.where`, `.having`) | ANDs with existing | `(existing?) => Node` |
| Array (`.from`, `.orderBy`, `.groupBy`, `.returning`) | Appends | `(existing) => Node[]` |
| Single value (`.limit`, `.offset`) | Overwrites | `(existing?) => Node` |
| Object (`.set`) | Merges keys | `(existing) => Record` |

```typescript
// Single clause: .where(), .having()
.where(eq('active', true))                                  // AND
.where(existing => or(existing, eq('role', val('admin'))))   // lambda: OR

// Array: .from(), .orderBy(), .groupBy(), .returning()
.orderBy('created_at', 'desc')                               // append
.orderBy(existing => existing.filter(s => ...))              // lambda: filter/replace

// Single value: .limit(), .offset()
.limit(100)                                                  // overwrite
.limit(existing => add(existing, 10))                        // lambda: modify

// Object: .set()
.set({ price: val(99) })                                    // merge
.set(existing => ({ ...existing, updated_at: func('now') })) // lambda: full control
```

Note: `and()` and `or()` silently skip `undefined` args, so lambda WHERE is always clean:
```typescript
.where(existing => or(existing, eq('role', val('admin'))))
// If existing is undefined → just eq('role', val('admin'))
```

### 10. Parse → Modify: DDL modifications

`transform()` is the primary way to modify — changes stay in context.

```typescript
const ast = await unwrapParseResult(parser.parse(`
  CREATE TABLE users (id serial PRIMARY KEY, name text NOT NULL);
  CREATE TABLE posts (id serial PRIMARY KEY, title text);
  CREATE TABLE comments (id serial PRIMARY KEY, body text);
`))

const q = query(ast)

// transform specific table — callback receives CreateTableQuery
const modified = q.transform('CreateStmt', hasTable('posts'), ct =>
  ct.column('slug', 'text', c => c.unique())                     // ensure column
    .column('title', c => c.notNull())                            // ensure + add constraint
    .column('created_at', 'timestamptz', c => c.notNull().default(func('now')))
    .dropColumn('body')
)
// → AstQuery<ParseResult> with posts table modified, others untouched

// transform ALL tables (no predicate)
const withTimestamps = q.transform('CreateStmt', ct =>
  ct.column('created_at', 'timestamptz', c => c.notNull().default(func('now')))
    .column('updated_at', 'timestamptz', c => c.notNull().default(func('now')))
)

// Rename a table — transform on RangeVar
const renamed = q.transform('RangeVar', rv =>
  rv.node.relname === 'comments' ? rv.set({ relname: 'replies' }) : rv
)
```

`find()` for inspection — detached, doesn't modify original tree:
```typescript
const posts = q.find('CreateStmt', hasTable('posts'))  // CreateTableQuery | undefined
posts?.findAll('ColumnDef')  // inspect columns
```

`query()` accepts both `ParseResult` (multi-statement) and single unwrapped nodes. `.node` → unwrapped inner object, `.toSQL()` → deparsed SQL.

### 11. Predicates and FindContext

All 5 selectors accept an optional predicate `(node, ctx) => boolean`. The predicate receives both the unwrapped node and a context object describing where in the tree it was found.

**FindContext:**
```typescript
type FindContext = {
  index?: number       // position in parent array (undefined if not in array)
  parent: unknown      // the parent object containing this node
  parentKey: string    // key on parent ('targetList', 'whereClause', etc.)
  path: string[]       // full ancestry: ['stmts', '0', 'stmt', 'SelectStmt', 'targetList', '0']
}
```

```typescript
const ast = await unwrapParseResult(parser.parse(`
  SELECT * FROM users;
  DELETE FROM sessions;
  SELECT id FROM orders WHERE 1=1;
`))

const q = query(ast)

// Predicate with context — scoping via path
q.findAll('ColumnRef', (node, ctx) => {
  return ctx.path.includes('whereClause')  // only columns inside WHERE
})

// Scoped search: any builder can search within its subtree
const allSelects = q.findAll('SelectStmt')
const tablesInFirst = allSelects[0].findAll('RangeVar')

// Collect data
const tableNames = new Set<string>()
q.findAll('RangeVar').forEach(rv => {
  const { relname } = rv.node
  if (relname) tableNames.add(relname)
})
// Set { 'users', 'sessions', 'orders' }
```

**Predicate helpers** — composable shortcuts for common patterns:

```typescript
hasTable('users')             // node contains RangeVar with relname 'users'
hasColumn('email')            // node contains ColumnRef matching 'email'
hasStar                       // ColumnRef has A_Star field
inContext('whereClause')      // ctx.path includes 'whereClause'
inContext('targetList')       // inside a SELECT list
```

Usage with any selector:
```typescript
q.find('DeleteStmt', node => !node.whereClause)    // inline predicate
q.findAll('SelectStmt', hasTable('users'))          // predicate helper
q.transformAll('SelectStmt', hasTable('orders'), sq => sq.where(...))
q.has('ColumnRef', hasStar)                         // boolean
```

### 12. Parse → Modify: Rename tables across a complex query

```typescript
const ast = await unwrapParseResult(parser.parse(`
  WITH active_users AS (
    SELECT id, name FROM users WHERE active = true
  )
  SELECT au.name, COUNT(p.id)
  FROM active_users au
  JOIN posts p ON au.id = p.user_id
  GROUP BY au.name
`))

// transform reaches every RangeVar at every depth (CTEs, JOINs, subqueries)
const renames: Record<string, string> = { users: 'accounts', posts: 'articles' }
const sql = await query(ast)
  .transform('RangeVar', rv => {
    const { relname } = rv.node
    return relname && renames[relname]
      ? rv.set({ relname: renames[relname] })
      : rv
  })
  .toSQL()
```

### 13. CTE query with UNION

```typescript
const activeUsers = select('id', 'name', 'email')
  .from('users')
  .where(eq('active', true))

const invitedUsers = select('id', 'name', 'email')
  .from('invitations')
  .where(eq('accepted', true))

const sql = await select(star())
  .with('all_users', activeUsers.union(invitedUsers))
  .from('all_users')
  .orderBy('name')
  .toSQL()
```

### 14. Inline AST for unsupported expressions

For expressions not covered by helpers, pass raw AST JSON directly — it's just a `Node`:
```typescript
const customNode: Node = { A_Expr: { kind: 'AEXPR_OP', name: [{ String: { sval: '~' } }],
  lexpr: col('name'), rexpr: val('^[A-Z]') } }
select('id').from('users').where(customNode)
```

See **Phase 2** for `raw()` string parsing and auto-raw coercion.

### 15. Build parameterized queries

```typescript
const sql = await select('id', 'name', 'email')
  .from('users')
  .where(
    and(
      eq('tenant_id', param(1)),
      gte('created_at', param(2)),
      like('name', param(3)),
    ),
  )
  .limit(param(4))
  .toSQL()

// SELECT id, name, email FROM users
// WHERE tenant_id = $1 AND created_at >= $2 AND name LIKE $3 LIMIT $4
```

### 16. Parse → Modify: Add columns + WHERE to existing SELECT

```typescript
const ast = await unwrapParseResult(parser.parse('SELECT id FROM users WHERE active = true'))

// transform: callback receives SelectQuery — use builder methods
const modified = query(ast).transform('SelectStmt', sq =>
  sq.where(gte('created_at', val('2024-01-01')))
    .orderBy('created_at', 'desc')
    .limit(50)
    .returning(existing => [
      ...existing,
      alias(col('name'), 'name'),
      alias(col('email'), 'email'),
    ])
)
```

---

## Technical Design

### Package Structure

Same package (`pg-parser`), new entry point `pg-parser/ast`. Keeps types tightly coupled.

```
packages/pg-parser/src/ast/
  index.ts              # Public re-exports
  types.ts              # NodeTypeName, NodeOfType, ExprArg, BuilderFor, coerce()
  nodes.ts              # col, val, star, table, func, param, cast, sort, typeName, columnDef
  expressions.ts        # eq, gt, and, or, isNull, like, between, inList, exists, etc.
  traverse.ts           # Internal: rawFind, rawTransform, rawVisit (used by builders)
  predicates.ts         # hasTable, hasColumn, hasStar, inContext
  query.ts              # AstQuery<T> base class + query() entry point
  factory.ts            # createAstTools(parser) — binds parser to builders + query
  builders/
    index.ts
    select.ts           # SelectQuery extends AstQuery<SelectStmt>
    insert.ts           # InsertQuery extends AstQuery<InsertStmt>
    update.ts           # UpdateQuery extends AstQuery<UpdateStmt>
    delete.ts           # DeleteQuery extends AstQuery<DeleteStmt>
    create-table.ts     # CreateTableQuery extends AstQuery<CreateStmt>
    alter-table.ts      # AlterTableQuery extends AstQuery<AlterTableStmt>
    create-index.ts     # CreateIndexQuery extends AstQuery<IndexStmt>
```

### Core Types (`types.ts`)

```typescript
import type { Node } from '../../wasm/17/pg-parser-types.js'

// Extract union member keys: 'SelectStmt' | 'InsertStmt' | ...
type NodeTypeName = ExtractKeys<Node>

// Map type name → unwrapped interface: NodeOfType<'SelectStmt'> → SelectStmt
type NodeOfType<T extends NodeTypeName> = Extract<Node, Record<T, any>>[T]

// Auto-coercion input type for expression helpers
type ExprArg = string | number | boolean | null | Node

// Coerce an ExprArg to a Node:
//   string     → col(string)  (dotted strings like 'u.id' → col('u', 'id'))
//   number     → val(number)
//   boolean    → val(boolean)
//   null       → val(null)
//   Node       → passthrough
function coerce(arg: ExprArg): Node
```

All expression helpers accept `ExprArg` instead of `Node`. The `coerce()` function handles the mapping internally. For string VALUES (not column names), wrap with `val('Alice')`.

### Node Factories (`nodes.ts`)

All return `Node` (the wrapped form).

| Factory | Returns | Notes |
|---------|---------|-------|
| `col(...parts)` | `{ ColumnRef }` | `col('id')`, `col('u', 'id')` |
| `val(value)` | `{ A_Const }` | Auto-detects ival/sval/fval/boolval/null |
| `star(table?)` | `{ ColumnRef }` | `*` or `table.*` |
| `table(name, schema?)` | `{ RangeVar }` | Sets `inh: true, relpersistence: 'p'` |
| `tableAlias(name, alias)` | `{ RangeVar }` | Attaches Alias to RangeVar |
| `alias(expr, name)` | `{ ResTarget }` | SELECT target with alias |
| `func(name, ...args)` | `{ FuncCall }` | Args accept ExprArg too |
| `param(n)` | `{ ParamRef }` | `$1`, `$2`, etc. |
| `cast(expr, type)` | `{ TypeCast }` | Type cast |
| `sort(expr, dir?, nulls?)` | `{ SortBy }` | ORDER BY element |
| `typeName(name, mod?)` | `{ TypeName }` | Type reference for DDL |
| `columnDef(name, type, cfg?)` | `{ ColumnDef }` | Column def with ColumnBuilder callback |

### Expression Helpers (`expressions.ts`)

All accept `ExprArg` (auto-coerced), all return `Node`.

| Helper | AST Node | SQL |
|--------|----------|-----|
| `eq(l, r)` | `A_Expr(AEXPR_OP, '=')` | `l = r` |
| `neq(l, r)` | `A_Expr(AEXPR_OP, '<>')` | `l <> r` |
| `gt`, `gte`, `lt`, `lte` | `A_Expr(AEXPR_OP, ...)` | `>`, `>=`, `<`, `<=` |
| `and(...exprs)` | `BoolExpr(AND_EXPR)` | `a AND b AND c` (skips undefined args) |
| `or(...exprs)` | `BoolExpr(OR_EXPR)` | `a OR b OR c` (skips undefined args) |
| `not(expr)` | `BoolExpr(NOT_EXPR)` | `NOT a` |
| `isNull(expr)` | `NullTest(IS_NULL)` | `a IS NULL` |
| `isNotNull(expr)` | `NullTest(IS_NOT_NULL)` | `a IS NOT NULL` |
| `like(expr, pat)` | `A_Expr(AEXPR_LIKE)` | `a LIKE b` |
| `ilike(expr, pat)` | `A_Expr(AEXPR_ILIKE)` | `a ILIKE b` |
| `between(expr, lo, hi)` | `A_Expr(AEXPR_BETWEEN)` | `a BETWEEN b AND c` |
| `inList(expr, vals)` | `A_Expr(AEXPR_IN)` | `a IN (b, c, d)` |
| `exists(subquery)` | `SubLink(EXISTS_SUBLINK)` | `EXISTS (SELECT ...)` |
| `inSubquery(expr, sq)` | `SubLink(ANY_SUBLINK)` | `a IN (SELECT ...)` |
| `add`, `sub`, `mul`, `div` | `A_Expr(AEXPR_OP, ...)` | `+`, `-`, `*`, `/` |

### Internal Traversal (`traverse.ts`)

Low-level recursive walk functions used internally by the builder classes. Not part of the public API — users interact through builders.

- `rawFind(root, nodeType, predicate?)` — depth-first walk, returns unwrapped nodes
- `rawTransform(root, nodeType, fn)` — immutable deep rebuild
- `rawVisit(root, visitors)` — walk with callbacks

**FindContext** (passed to predicates):
```typescript
type FindContext = {
  index?: number       // position in parent array (undefined if not in array)
  parent: unknown      // the parent object containing this node
  parentKey: string    // key on parent ('targetList', 'whereClause', etc.)
  path: string[]       // full ancestry from root
}
```

### Predicate Helpers (`predicates.ts`)

Small composable functions for find/filter predicates:

```typescript
hasTable(name: string)        // node contains RangeVar with relname === name
hasColumn(name: string)       // node contains ColumnRef matching name
hasStar                       // ColumnRef has A_Star field
inContext(key: string)        // ctx.path includes key (e.g. 'whereClause', 'targetList')
```

### Builder Hierarchy

Unified type hierarchy. Build from scratch OR wrap existing AST — same classes.

```typescript
// Base class — wraps any AST node
class AstQuery<T = unknown> {
  readonly #node: T
  readonly #parser?: PgParser

  // All four share the same targeting: (type, predicate?)
  // find/findAll return detached builders (same class, just not connected to tree)
  // transform/transformAll modify in context (callback receives builder, returns modified)
  find<U>(type: U, pred?): BuilderFor<U> | undefined           // first match, detached
  findAll<U>(type: U, pred?): BuilderFor<U>[]                  // all matches, detached
  transform<U>(type: U, fn): AstQuery<T>                       // first match, in context
  transform<U>(type: U, pred, fn): AstQuery<T>                 // with predicate
  transformAll<U>(type: U, fn): AstQuery<T>                    // all matches, in context
  transformAll<U>(type: U, pred, fn): AstQuery<T>              // with predicate
  has(type: NodeTypeName, pred?): boolean                       // existence check

  // Raw field access (sync in Phase 1, becomes Promise<T> in Phase 2)
  readonly node: T                     // the unwrapped AST object (read raw fields)

  // Output
  toSQL(parser?): Promise<string>      // only async exit point in Phase 1
}

// Statement builders extend the base — add statement-specific methods
class SelectQuery extends AstQuery<SelectStmt> {
  where(expr | fn): SelectQuery
  from(...): SelectQuery
  having(expr | fn): SelectQuery
  orderBy(...): SelectQuery
  limit(...): SelectQuery
  offset(...): SelectQuery
  groupBy(...): SelectQuery
  distinct(): SelectQuery
  join(...): SelectQuery
  leftJoin(...): SelectQuery
  with(name, query): SelectQuery
  union(...): SelectQuery
  forUpdate(): SelectQuery
  returning(...): SelectQuery
}

class InsertQuery extends AstQuery<InsertStmt> { ... }
class UpdateQuery extends AstQuery<UpdateStmt> { ... }
class DeleteQuery extends AstQuery<DeleteStmt> { ... }
class CreateTableQuery extends AstQuery<CreateStmt> { ... }
class AlterTableQuery extends AstQuery<AlterTableStmt> { ... }
class CreateIndexQuery extends AstQuery<IndexStmt> { ... }
```

**Type-safe builder resolution:**
```typescript
type BuilderFor<T extends NodeTypeName> =
  T extends 'SelectStmt' ? SelectQuery :
  T extends 'InsertStmt' ? InsertQuery :
  T extends 'UpdateStmt' ? UpdateQuery :
  T extends 'DeleteStmt' ? DeleteQuery :
  T extends 'CreateStmt' ? CreateTableQuery :
  T extends 'AlterTableStmt' ? AlterTableQuery :
  T extends 'IndexStmt' ? CreateIndexQuery :
  AstQuery<NodeOfType<T>>   // fallback: base class, no extra methods

// Type-safe results:
q.find('SelectStmt')        // → SelectQuery | undefined — has .where(), .limit()
q.find('CreateStmt')        // → CreateTableQuery | undefined — has .column()
q.find('ColumnRef')         // → AstQuery<ColumnRef> | undefined — just .find(), .transform(), .node
q.findAll('SelectStmt')     // → SelectQuery[]
```

**`query()` entry point** — detects statement type at runtime, returns typed builder:
```typescript
function query(node: ParseResult): AstQuery<ParseResult>
function query(node: SelectStmt): SelectQuery
function query(node: CreateStmt): CreateTableQuery
// ... overloads for each known statement type
function query(node: unknown): AstQuery

// Runtime: checks keys to determine type
function query(node: any) {
  if (node.stmts) return new AstQuery(node)         // ParseResult
  if (node.targetList !== undefined || node.fromClause !== undefined) return new SelectQuery(node)
  if (node.tableElts !== undefined) return new CreateTableQuery(node)
  // ... etc
  return new AstQuery(node)
}
```

**Build from scratch vs wrap existing — same class:**
```typescript
// From scratch:
select('id', 'name').from('users').where(eq('active', true))  // → SelectQuery

// From existing AST:
query(ast).find('SelectStmt')?.where(eq('active', true))   // → SelectQuery (same class!)

// Both produce identical .toSQL() output
```

### Factory (`factory.ts`)

Binds a `PgParser` instance so you don't pass it everywhere:

```typescript
function createAstTools(parser: PgParser) {
  return {
    // Build from scratch — returns typed builders with parser bound
    select(...columns: (string | Node)[]) → SelectQuery,
    insert(into: string | Node) → InsertQuery,
    update(tbl: string | Node) → UpdateQuery,
    deleteFrom(tbl: string | Node) → DeleteQuery,
    createTable(name: string, schema?: string) → CreateTableQuery,
    alterTable(name: string, schema?: string) → AlterTableQuery,
    createIndex(name: string) → CreateIndexQuery,

    // Wrap existing AST — returns typed builder with parser bound
    query(node) → AstQuery | typed subclass,
  }
}

### Statement Builder APIs

All methods support value form (default) and lambda form (full control). Every method is immutable (returns new instance).

**SelectQuery**: `select(...columns)` or `query(selectStmt)`
- `.from()`, `.where()`, `.having()`
- `.join()`, `.leftJoin()`, `.rightJoin()`, `.fullJoin()`
- `.orderBy()`, `.limit()`, `.offset()`
- `.groupBy()`, `.distinct()`
- `.with(name, query)`, `.union()`, `.except()`, `.intersect()`
- `.returning()`, `.forUpdate()`

**InsertQuery**: `insert(table)` or `query(insertStmt)`
- `.columns()`, `.values()`, `.fromSelect()`
- `.onConflict({ columns, action, where })`
- `.returning()`

**UpdateQuery**: `update(table)` or `query(updateStmt)`
- `.set({ col: val, ... })`
- `.where()`, `.from()`, `.returning()`

**DeleteQuery**: `deleteFrom(table)` or `query(deleteStmt)`
- `.where()`, `.using()`, `.returning()`

**CreateTableQuery**: `createTable(name, schema?)` or `query(createStmt)`
- `.column(name, type)` — ensure column with type
- `.column(name, type, fn)` — ensure column with type + builder config
- `.column(name, fn)` — ensure column, keep existing type, apply builder
- `.columns(fn)` — array lambda over all columns
- `.dropColumn()`, `.primaryKey()`, `.unique()`, `.check()`, `.foreignKey()`, `.ifNotExists()`

**AlterTableQuery**: `alterTable(name, schema?)` or `query(alterStmt)`
- `.column()`, `.columns()` — same overloads as CreateTableQuery
- `.dropColumn()`, `.renameColumn()`
- `.addConstraint()`, `.dropConstraint()`

**CreateIndexQuery**: `createIndex(name)` or `query(indexStmt)`
- `.on()`, `.columns()`, `.using()`, `.unique()`, `.where()`
- `.concurrently()`, `.ifNotExists()`, `.include()`

## Implementation Order

1. **types.ts** — `NodeTypeName`, `NodeOfType`, `ExprArg`, `BuilderFor`, `coerce()`
2. **nodes.ts** — all node factories
3. **expressions.ts** — all expression helpers (using coerce internally)
4. **traverse.ts** — internal `rawFind`, `rawTransform`, `rawVisit` (with FindContext)
5. **predicates.ts** — hasTable, hasColumn, hasStar, inContext
6. **query.ts** — `AstQuery<T>` base class + `query()` entry point
7. **builders/select.ts** — SelectQuery (most complex, do first)
8. **builders/insert.ts, update.ts, delete.ts** — other DML builders
9. **builders/create-table.ts, alter-table.ts, create-index.ts** — DDL builders
10. **factory.ts** — createAstTools binding (builders + query)
11. **index.ts** — public re-exports
12. Tests for each module

## Files to Modify

- `packages/pg-parser/package.json` — add `"./ast"` export path
- `packages/pg-parser/tsconfig.json` — ensure `src/ast/` included

## Files to Create

- `packages/pg-parser/src/ast/types.ts`
- `packages/pg-parser/src/ast/nodes.ts`
- `packages/pg-parser/src/ast/expressions.ts`
- `packages/pg-parser/src/ast/traverse.ts`
- `packages/pg-parser/src/ast/predicates.ts`
- `packages/pg-parser/src/ast/query.ts`
- `packages/pg-parser/src/ast/factory.ts`
- `packages/pg-parser/src/ast/index.ts`
- `packages/pg-parser/src/ast/builders/index.ts`
- `packages/pg-parser/src/ast/builders/select.ts`
- `packages/pg-parser/src/ast/builders/insert.ts`
- `packages/pg-parser/src/ast/builders/update.ts`
- `packages/pg-parser/src/ast/builders/delete.ts`
- `packages/pg-parser/src/ast/builders/create-table.ts`
- `packages/pg-parser/src/ast/builders/alter-table.ts`
- `packages/pg-parser/src/ast/builders/create-index.ts`
- `packages/pg-parser/src/ast/__tests__/nodes.test.ts`
- `packages/pg-parser/src/ast/__tests__/expressions.test.ts`
- `packages/pg-parser/src/ast/__tests__/traverse.test.ts`
- `packages/pg-parser/src/ast/__tests__/query.test.ts`
- `packages/pg-parser/src/ast/__tests__/builders.test.ts`

## Critical Existing Files

- [pg-parser-types.d.ts](packages/pg-parser/wasm/17/pg-parser-types.d.ts) — 271 generated interfaces, the `Node` union
- [pg-parser-enums.d.ts](packages/pg-parser/wasm/17/pg-parser-enums.d.ts) — enum types (A_Expr_Kind, JoinType, etc.)
- [util.ts](packages/pg-parser/src/util.ts) — existing unwrapNode, assertAndUnwrapNode
- [pg-parser.ts](packages/pg-parser/src/pg-parser.ts) — PgParser class (parse/deparse)
- [types/index.ts](packages/pg-parser/src/types/index.ts) — version-mapped type exports

## Verification

1. **Unit tests**: node factories produce correct AST shapes, expression helpers produce correct A_Expr/BoolExpr/etc.
2. **Roundtrip tests**: `builder.toSQL()` → parse back → compare AST structure
3. **Transform tests**: parse real SQL → transform → deparse → verify SQL output
4. **Query chain tests**: parse SQL → transform with builder callbacks → deparse → verify
5. **Existing suite**: `pnpm test` (1090 tests) stays green — purely additive changes
6. **Type checking**: `pnpm tsc --noEmit`


---

## Phase 2: `raw()` and Async

### Why

Phase 1 helpers cover common expressions (`eq`, `and`, `like`, etc.) but SQL has endless syntax. When a helper doesn't exist, you're stuck hand-building AST JSON (see scenario 14). `raw()` bridges the gap — write SQL strings for any expression and they become real AST nodes.

Parsing a SQL fragment into an AST node requires calling the WASM parser — an inherently async operation. This is why Phase 2 introduces a new async paradigm: `raw()` needs to parse, and that parse is async.

### DX: strings as implicit raw expressions

In **expression positions**, plain strings are auto-parsed as SQL fragments:

```typescript
// Strings in expression positions → parsed as SQL automatically
.where('active = true')
.where('age > 18 AND role = \'admin\'')
and('deleted_at IS NULL', eq('status', val('active')))
or('price > 100', like('name', val('%sale%')))
```

For explicit control, use `raw()` directly:
```typescript
const expr = raw('age > 18 AND active = true')
select('id').from('users').where(expr)
```

**Where auto-raw applies** (expression positions — string is ambiguous, treat as SQL):
- `.where(string)`, `.having(string)`, `.check(string)`
- `and(string, ...)`, `or(string, ...)`, `not(string)`

**Where auto-raw does NOT apply** (identity/value positions — existing Phase 1 coercion stays):
- `eq('name', 'Alice')` — left → `col()`, right → `val()` (unchanged)
- `.from('users')` — table name (unchanged)
- `.orderBy('created_at')` — column name (unchanged)

### How it works: promises as nodes

`raw()` returns `Promise<Node>` — it eagerly starts WASM parsing and stores the promise directly in the tree. No custom marker types. Resolution is just deep-awaiting at output time.

```typescript
raw('active = true')  // → Promise<Node> (parsing starts immediately)

// By .toSQL() time, the promise may already be settled
select('id').from('users').where(raw('active = true')).toSQL()
```

This means `.node` becomes `Promise<T>` — it deep-resolves all promises in the tree and returns clean, fully-typed `T`:

```typescript
const node = await q.node   // Promise<SelectStmt> → SelectStmt (fully resolved)
await q.toSQL()             // resolves + deparses
```

This is a **breaking change from Phase 1** where `.node` is sync. We won't release Phase 1 publicly, so no external breakage.

### Async transforms

Making `.node` async unlocks async transform callbacks for free. Most transforms stay sync (builder methods don't need resolved fields), but async is available when needed:

```typescript
// Sync — most common, builder methods are sync
q.transformAll('SelectStmt', sq =>
  sq.where(eq('tenant_id', param(1)))
)

// Async — inspect resolved fields to make decisions
q.transform('RangeVar', async rv => {
  const { relname } = await rv.node
  return relname === 'users' ? rv.set({ relname: 'accounts' }) : rv
})
```

Async callbacks return `Promise<Builder>` — stored in the tree, resolved at `.node` / `.toSQL()` time. No blocking during the build chain.

This also opens the door to **external async work** inside transforms — schema lookups, config fetches, policy injection:

```typescript
// Schema-aware: query a live DB before deciding
q.transform('CreateStmt', async ct => {
  const exists = await db.tableExists(tableName)
  return exists ? ct : ct.ifNotExists()
})

// Policy injection: fetch tenant rules from an API
q.transform('SelectStmt', async sq => {
  const policies = await fetchRlsPolicies(tenantId)
  return sq.where(policies.toExpr())
})
```

### Async traversal

Since the tree can contain promises, `find()`/`findAll()`/`transform()`/`transformAll()`/`has()` all become async in Phase 2. The walker resolves promises as it descends so predicates always see clean, resolved nodes.

```typescript
// Phase 1 (sync):
q.find('SelectStmt')                    // SelectQuery | undefined
q.has('ColumnRef', hasStar)             // boolean

// Phase 2 (async — tree may contain promises):
await q.find('SelectStmt')              // Promise<SelectQuery | undefined>
await q.has('ColumnRef', hasStar)       // Promise<boolean>
```

Predicates accept `(node, ctx) => boolean | Promise<boolean>` — sync predicates work unchanged, async ones are awaited by the walker. The walker resolves promise nodes before calling predicates, so predicates always see clean AST.

### Updated type surface (Phase 2)

```typescript
class AstQuery<T = unknown> {
  get node(): Promise<T>           // deep-resolves all promises, returns clean T
  toSQL(parser?): Promise<string>

  // All selectors become async — walker resolves promises before descending
  find<U>(type, pred?): Promise<BuilderFor<U> | undefined>
  findAll<U>(type, pred?): Promise<BuilderFor<U>[]>
  transform<U>(type, fn: (b) => BuilderFor<U> | Promise<BuilderFor<U>>): AstQuery<T>
  transformAll<U>(type, fn: (b) => BuilderFor<U> | Promise<BuilderFor<U>>): AstQuery<T>
  has(type, pred?): Promise<boolean>
}
```

### Dependencies and implementation

> **Dependency**: Fragment-level parsing. The current parser only handles top-level statements — expression fragments like `active = true` can't be parsed directly. Approach: wrap in `SELECT (expr)`, parse the statement, extract from `targetList[0]`.

> **Dependency**: Fragment-level deparsing. Currently `.toSQL()` wraps in a full `ParseResult` to deparse. Ideally any builder node can call `.toSQL()` directly — e.g. deparse just a `SelectStmt` or even an expression node. Approach: wrap the node in a minimal `ParseResult` shell before deparsing. This lets `query(selectStmt).toSQL()` work without the caller needing to know about `ParseResult` wrapping.

1. Fragment parsing support in libpg_query (wrap in `SELECT (expr)`)
2. Fragment deparsing support (wrap node in `ParseResult` shell)
3. `raw(sql: string): Promise<Node>` — eagerly parses fragment, returns promise
4. Builder internals accept `Node | Promise<Node>` in expression positions
5. Expression-position methods auto-coerce strings to `raw()`
6. `.node` returns `Promise<T>` — deep-resolve via recursive walk + `Promise.all`
7. `transform`/`transformAll` accept sync or async callbacks — async results stored as promises

### Open design question: conditional sync/async return types

Phase 2 makes all selectors async unconditionally — even when the tree has zero promises (i.e. no `raw()` calls). This means pure Phase 1 usage patterns pay the async tax for no reason:

```typescript
// No raw() anywhere — tree is fully sync, but still returns Promise
const sq = await q.find('SelectStmt')  // unnecessary await
```

**Idea**: use a generic flag to track whether promises have been introduced:

```typescript
type MaybePromise<Async extends boolean, T> = Async extends true ? Promise<T> : T

class AstQuery<T = unknown, Async extends boolean = false> {
  get node(): MaybePromise<Async, T>
  find<U>(type, pred?): MaybePromise<Async, BuilderFor<U> | undefined>
  findAll<U>(type, pred?): MaybePromise<Async, BuilderFor<U>[]>
  has(type, pred?): MaybePromise<Async, boolean>
  // transform/transformAll always return AstQuery (sync chain), so less affected
}
```

Builder methods that accept `Promise<Node>` (from `raw()`) flip the flag:

```typescript
// Overloads — sync input keeps Async=false, async input flips to true
class SelectQuery<Async extends boolean = false> {
  where(expr: Node): SelectQuery<Async>                    // preserves current flag
  where(expr: Promise<Node>): SelectQuery<true>            // flips to async
  where(expr: Node | Promise<Node>): SelectQuery<boolean>  // union — loses precision
}
```

**Tradeoffs**:
- Pro: ideal progressive DX — sync trees stay sync, async only when needed
- Pro: no unnecessary `await` for pure builder usage
- Con: extra generic parameter on every class (`AstQuery<T, Async>`, `SelectQuery<Async>`)
- Con: overload signatures get complex — every method that accepts expressions needs sync/async variants
- Con: noisier TypeScript error messages (more generics = harder to read)
- Con: `boolean` union type loses precision when mixing sync/async inputs in one chain

Worth exploring during Phase 2 implementation. Could start with unconditional async (simpler) and retrofit the generic flag if the DX cost is too high in practice
