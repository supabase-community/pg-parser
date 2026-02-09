# AST Tools Phase 1.1: Selector & Predicate DX

Design decisions from brainstorming session. Builds on top of Phase 1 (AST_TOOLS.md).

---

## Core Design Principle: Progressive Disclosure

Easy DX covers 80% of common use cases, then progressively falls back to more complex DX for less common cases, then full escape hatch for very uncommon/complex work.

| Tier | Knowledge Required | Tools |
|------|-------------------|-------|
| **Tier 1** | SQL clause names | Clause getters + `.exists` + `.has()` on clauses |
| **Tier 2** | Node type names (~6 common ones) | `find` / `findAll` / `has` with wrapped predicates + `.name` / `.schema` accessors |
| **Tier 3** | Raw AST field shapes | `.node` escape hatch for full AST access |

---

## Decision: Predicates Receive Wrapped AstQuery

**Before:** predicates received raw unwrapped nodes.

```typescript
// Old: raw node, no utilities
q.find('SelectStmt', (node, ctx) => {
  // Can only check raw fields. No has(), find(), findAll().
  return node.fromClause !== undefined
})
```

**After:** predicates receive AstQuery-wrapped nodes.

```typescript
// New: wrapped, full traversal API available
q.find('SelectStmt', (sq, ctx) => {
  return sq.has('RangeVar', rv => rv.name === 'users')
})
```

**Why:** The predicate helpers (`hasTable`, `hasColumn`) had privileged access to `rawFind` internally. Regular consumers writing inline predicates had no clean way to do descendant searching. Design principle: if helpers can do it, consumers should be able to do it too, using the same primitives.

**Predicate type change:**
```typescript
// Before:
type Predicate<T> = (node: T, ctx: FindContext) => boolean

// After:
type Predicate<U extends NodeTypeName> = (query: AstQuery<NodeOfType<U>>, ctx: FindContext) => boolean
```

---

## Decision: Drop hasTable / hasColumn / hasStar Predicate Helpers

With wrapped predicates, these become expressible via primitives:

```typescript
// hasTable('users') → use primitives
sq.has('RangeVar', rv => rv.name === 'users')

// hasColumn('email') → use primitives
sq.has('ColumnRef', cr => cr.name === 'email')

// hasStar → use primitives
sq.has('ColumnRef', cr => cr.isStar)
```

**Keep `inContext`** — it operates on `ctx.path`, not the node. Different concern.

---

## Decision: Typed Accessors on Node Types

Raw AST field shapes are inconsistent and unintuitive. Typed accessors hide this:

| Node Type | `.name` reads | `.schema` reads | Other |
|-----------|--------------|----------------|-------|
| RangeVar | `relname` | `schemaname` | `.alias` |
| ColumnRef | `fields[].String.sval` (unwraps) | — | `.isStar` |
| ColumnDef | `colname` | — | — |
| FuncCall | `funcname[].String.sval` (unwraps) | — | — |
| CommonTableExpr | `ctename` | — | — |
| IndexStmt | `idxname` | — | — |

These absorb the field-shape inconsistency so users don't need to know that ColumnRef stores names as `fields[].String.sval`.

---

## Decision: Clause Getters with Auto-Unwrap

PG AST has an envelope/wrapper pattern: every Node is `{ TypeName: { ...fields } }`. Accessing a field on `.node` gives you the wrapped form. Users would need to detect the type key, unwrap, and re-wrap in AstQuery — nobody should have to do this.

**Solution:** Builder properties that auto-unwrap the envelope and return a wrapped AstQuery.

```typescript
// Instead of this (manual envelope dance):
const wrapped = sq.node.whereClause        // { A_Expr: { kind: ..., ... } }
const typeName = Object.keys(wrapped)[0]   // 'A_Expr'
const inner = wrapped[typeName]            // { kind: ..., ... }
builderFactory(typeName, inner, parser)    // AstQuery

// Just do this:
sq.whereClause                             // AstQuery (auto-unwrapped + wrapped)
```

**Implementation:** computed property getters on each builder, not Proxy. Boilerplate is mechanical but fully type-safe with great autocomplete.

### Clause getter inventory

**SelectQuery:**
`whereClause`, `fromClause`, `targetList`, `sortClause`, `groupClause`, `havingClause`, `limitCount`, `limitOffset`, `distinctClause`, `withClause`

**DeleteQuery:**
`whereClause`, `returningList`, `usingClause`, `relation` (target table)

**UpdateQuery:**
`whereClause`, `returningList`, `fromClause`, `targetList`, `relation`

**InsertQuery:**
`returningList`, `onConflictClause`, `relation`

### No naming conflicts with builder methods

PG field names are verbose (`whereClause`, `fromClause`, `sortClause`, `limitCount`) while builder methods are terse (`where()`, `from()`, `orderBy()`, `limit()`). Different namespaces by convention.

---

## Decision: Null Object Pattern

Clause getters always return AstQuery, never undefined. An "empty" AstQuery (wrapping no node) has safe default behavior:

| Method | Empty AstQuery returns |
|--------|----------------------|
| `.has()` | `false` |
| `.findAll()` | `[]` |
| `.find()` | `undefined` |
| `.node` | `undefined` |
| `.exists` | `false` |

**Why:** In a query/selection API, "nothing found" is a normal state, not an error. jQuery proved this pattern — `$('.missing').addClass('foo')` is a no-op, not an error. Most AST clauses are absent most of the time (most SELECTs don't have HAVING, DISTINCT, etc.). Forcing `?.` everywhere treats absence as exceptional when it's the default.

```typescript
// No optional chaining noise:
sq.whereClause.has('ColumnRef', cr => cr.name === 'active')   // false if no WHERE
sq.whereClause.findAll('FuncCall')                             // [] if no WHERE
sq.sortClause.has('ColumnRef', cr => cr.name === 'created_at') // false if no ORDER BY
```

---

## Decision: `.exists` Getter on AstQuery

A boolean getter for explicit existence checks.

```typescript
get exists(): boolean {
  return this.node !== undefined
}
```

**Why not just use `.node`?** `.node` reads as "give me the raw AST" — using it as an existence check is a side effect, not self-documenting intent.

```typescript
if (!del.whereClause.node)    // "...the node what?"
if (!del.whereClause.exists)  // instantly clear
```

---

## Decision: No `has*()` / `is*()` Boolean Accessors on Builders

Originally proposed `hasWhere()`, `hasLimit()`, `hasOrderBy()`, etc. on each builder. **Replaced by clause getters + `.exists`:**

```typescript
// These are redundant now:
sq.hasWhere()       →  sq.whereClause.exists
sq.hasLimit()       →  sq.limitCount.exists
sq.hasOrderBy()     →  sq.sortClause.exists
sq.hasReturning()   →  del.returningList.exists

// Scoped search is also covered:
sq.hasWhere(pred)   →  sq.whereClause.has('ColumnRef', cr => cr.name === 'x')
```

Big API surface reduction. Clause getters handle both existence and inspection.

---

## Decision: No Full Collection Pattern

Considered jQuery-style collection model where everything is a collection of 0+. **Rejected because:**

1. Builder operations are single-node (`sq.where(expr)` adds WHERE to ONE statement). Silently applying to all elements in a collection is a footgun.
2. Breaks TypeScript narrowing on `find()` — collections are always truthy.
3. Our hybrid (single-node AstQuery + null object for clause getters) gets the "no `?.` noise" benefit without the "silently apply to N things" confusion.

---

## RangeVar Deep Dive

`RangeVar` = a named relation reference (tables, views, matviews, foreign tables). It does NOT include subqueries in FROM (`RangeSubselect`), functions in FROM (`RangeFunction`), or VALUES lists.

### Where RangeVar appears (footgun awareness)

1. **fromClause** — direct or inside JoinExpr
2. **relation field** — target table on INSERT/UPDATE/DELETE (semantically different from FROM)
3. **Inside subqueries** at any depth (their own fromClause)
4. **CTE references** — indistinguishable from table refs at parse time

### Implications

`findAll('RangeVar')` returns ALL of the above. This is correct for "does this query tree reference table X anywhere" but a footgun for "what tables are in the FROM clause."

Clause getters solve this naturally — `sq.fromClause` scopes to the FROM subtree. Combined with `find`/`findAll`, you get precise scoping without needing specialized `.tables()` accessors.

---

## Linting Use Cases (Design Validation)

These use cases drove the design decisions above.

### Tier 1 — zero AST knowledge

```typescript
// DELETE without WHERE
q.findAll('DeleteStmt').filter(del => !del.whereClause.exists)

// LIMIT without ORDER BY
q.findAll('SelectStmt').filter(sq => sq.limitCount.exists && !sq.sortClause.exists)

// INSERT without RETURNING
q.findAll('InsertStmt').filter(ins => !ins.returningList.exists)

// SELECT with DISTINCT (code smell)
q.findAll('SelectStmt').filter(sq => sq.distinctClause.exists)
```

### Tier 2 — learn ~6 node type names

```typescript
// SELECT * detection
q.findAll('SelectStmt').filter(sq => sq.has('ColumnRef', cr => cr.isStar))

// Tables without schema qualification
q.findAll('RangeVar').filter(rv => !rv.schema)

// Query references specific table
q.has('RangeVar', rv => rv.name === 'users')

// Function calls in WHERE (sargability lint)
q.findAll('FuncCall', (fn, ctx) => ctx.path.includes('whereClause'))
  .filter(fn => fn.has('ColumnRef'))

// Tables without aliases in multi-table query
q.findAll('RangeVar', (rv, ctx) => ctx.path.includes('fromClause'))
  .filter(rv => !rv.alias)
```

```typescript
// Implicit JOIN detection (FROM a, b instead of JOIN)
q.findAll('SelectStmt').filter(sq =>
  sq.fromClause.findAll('RangeVar').length > 1 && !sq.fromClause.has('JoinExpr')
)
```

### Tier 3 — raw AST escape hatch (expression internals, enum values)

```typescript
// NULL equality lint: WHERE x = NULL instead of IS NULL
// Requires understanding A_Expr structure, how operators are stored, how null constants look
q.findAll('A_Expr').filter(expr => {
  const n = expr.node
  return n.kind === 'AEXPR_OP'
    && n.name?.some(op => 'String' in op && op.String.sval === '=')
    && (n.lexpr && 'A_Const' in n.lexpr && 'isnull' in n.lexpr.A_Const)
})

// Style lint: no != operator, use <> instead
q.findAll('A_Expr').filter(expr => {
  const n = expr.node
  return n.name?.some(op => 'String' in op && op.String.sval === '!=')
})

// No implicit cross joins (INNER JOIN without ON condition)
q.findAll('JoinExpr').filter(j => j.node.jointype === 'JOIN_INNER' && !j.node.quals)
```

---

## Node Type Cheat Sheet (for docs)

| SQL Concept | PG Node Type | Notes |
|-------------|-------------|-------|
| Table / view reference | `RangeVar` | Also CTE references |
| Column reference | `ColumnRef` | `.name` accessor hides field shape |
| Column definition (DDL) | `ColumnDef` | |
| Function call | `FuncCall` | `.name` accessor hides field shape |
| JOIN | `JoinExpr` | `.jointype` for INNER/LEFT/etc. |
| Subquery (in expression) | `SubLink` | EXISTS, IN, ANY, etc. |
| Subquery (in FROM) | `RangeSubselect` | |
| CTE | `CommonTableExpr` | |
| Sort element | `SortBy` | |
| SELECT target | `ResTarget` | Column in result set |

---

## What Needs to Be Built (Delta from Phase 1)

1. **Predicate signature change** — wrap node in AstQuery before passing to predicate callbacks
2. **`.exists` getter** on AstQuery base class
3. **Null object support** — AstQuery that wraps undefined, with safe defaults for has/find/findAll
4. **Typed accessors** — `.name`, `.schema`, `.alias`, `.isStar` on relevant AstQuery specializations
5. **Clause getters** — computed properties on each builder that auto-unwrap envelope + return AstQuery
6. **Remove** `hasTable`, `hasColumn`, `hasStar` from predicates.ts (keep `inContext`)
7. **Node type cheat sheet** in docs

## Open Questions

- Exact set of typed accessors needed beyond `.name`, `.schema`, `.alias`, `.isStar`
- Whether `inContext` should be reworked given clause getters provide better scoping
- How clause getters interact with Phase 2 async (clause values could contain promises)
