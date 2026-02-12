# Postgres AST

A guide to understanding the structure of the PostgreSQL abstract syntax tree (AST) produced by `pg-parser`.

## Where the AST comes from

PostgreSQL has its own SQL parser written in C, built on a Bison grammar (`gram.y`) and a Flex lexer (`scan.l`). When Postgres parses a SQL string, it produces an internal parse tree made up of C structs — `SelectStmt`, `RangeVar`, `A_Expr`, etc. — all defined in the Postgres source under `include/nodes/parsenodes.h` and related headers.

[libpg_query](https://github.com/pganalyze/libpg_query) extracts the Postgres parser into a standalone C library. It also defines a protobuf schema (`pg_query.proto`) that is **auto-generated from the actual PostgreSQL C struct definitions** — each C node struct becomes a corresponding protobuf message with a 1:1 field mapping. The original C field names are preserved via `json_name` annotations on every protobuf field.

`pg-parser` compiles libpg_query to WebAssembly and converts the protobuf output into JSON. The AST you work with in JavaScript/TypeScript is a direct representation of the same parse tree that Postgres uses internally. The node names (`SelectStmt`, `A_Expr`, `RangeVar`, etc.), the field names (`targetList`, `fromClause`, `whereClause`, etc.), and the overall tree shape all come straight from the Postgres source.

This means the [PostgreSQL source code](https://github.com/postgres/postgres/blob/master/src/include/nodes/parsenodes.h) and [libpg_query's protobuf schema](https://github.com/pganalyze/libpg_query/blob/17-6.1.0/protobuf/pg_query.proto) are the authoritative references for understanding any node type. When you encounter an unfamiliar node, searching the Postgres source for its struct definition will tell you exactly what each field means.

## Top-level structure

Parsing a SQL string produces a `ParseResult`:

```typescript
interface ParseResult {
  version: number;   // e.g. 170004 for Postgres 17.0.4
  stmts: RawStmt[];
}
```

`version` encodes the major and minor Postgres version. `stmts` contains one `RawStmt` per semicolon-delimited statement in the input.

Each `RawStmt` wraps a statement node with source location metadata:

```typescript
interface RawStmt {
  stmt: Node;             // The actual statement (SelectStmt, InsertStmt, etc.)
  stmt_location?: number; // Byte offset of the statement start
  stmt_len?: number;      // Length in bytes (0 = to end of string)
}
```

## The node wrapping pattern

Every AST node in the JSON output is wrapped in an object with a single key: the node's type name. This is the most important structural pattern to understand.

```typescript
// A SelectStmt node:
{
  SelectStmt: {
    targetList: [ ... ],
    fromClause: [ ... ]
  }
}

// A column reference:
{
  ColumnRef: {
    fields: [{ String: { sval: "id" } }]
  }
}

// A constant:
{
  A_Const: {
    ival: { ival: 42 }
  }
}
```

This wrapping exists because Postgres's parse tree is polymorphic — many fields can hold different kinds of nodes. In the C source, this is handled via a `NodeTag` enum and void pointers. In the protobuf schema, it's a `oneof` inside a `Node` message with 260+ variants. In the JSON output, it becomes an object with a single key that tells you the node type.

This pattern appears **everywhere** in the tree. The `stmt` field in `RawStmt` is a wrapped node. Every element in `targetList`, `fromClause`, and `name` is a wrapped node. Expression fields like `whereClause`, `lexpr`, and `rexpr` are wrapped nodes. When you traverse the tree, you'll unwrap nodes at nearly every level.

Not every nested object is wrapped though. Fields that are typed as a specific message (rather than the generic `Node`) are embedded directly. For example, `RangeVar.alias` is typed as `Alias` (not `Node`), so it appears as `alias: { aliasname: "u" }` — no wrapping. The wrapping only happens for fields typed as `Node` in the protobuf schema, which is how Postgres represents polymorphic tree positions.

### Unwrapping nodes

You can unwrap manually:

```typescript
const stmt = rawStmt.stmt;

if ('SelectStmt' in stmt) {
  const selectStmt = stmt.SelectStmt;
  // work with selectStmt
}
```

Or use the `unwrapNode()` utility for type-safe unwrapping:

```typescript
import { unwrapNode } from '@supabase/pg-parser';

const { type, node } = unwrapNode(rawStmt.stmt);

switch (type) {
  case 'SelectStmt':
    // `node` is narrowed to SelectStmt
    console.log(node.targetList);
    break;
  case 'InsertStmt':
    // `node` is narrowed to InsertStmt
    console.log(node.relation);
    break;
}
```

## Node categories

The ~260 node types in Postgres's parse tree fall into several categories. You don't need to memorize them — but knowing the categories helps you reason about what kind of node to expect in a given position.

### Statement nodes

These represent top-level SQL commands. They appear as the `stmt` inside a `RawStmt`.

| Node | SQL |
|------|-----|
| `SelectStmt` | `SELECT` |
| `InsertStmt` | `INSERT` |
| `UpdateStmt` | `UPDATE` |
| `DeleteStmt` | `DELETE` |
| `CreateStmt` | `CREATE TABLE` |
| `IndexStmt` | `CREATE INDEX` |
| `ViewStmt` | `CREATE VIEW` |
| `AlterTableStmt` | `ALTER TABLE` |
| `DropStmt` | `DROP` |
| `TransactionStmt` | `BEGIN`, `COMMIT`, `ROLLBACK` |
| `CreateSchemaStmt` | `CREATE SCHEMA` |
| `GrantStmt` | `GRANT`, `REVOKE` |
| `ExplainStmt` | `EXPLAIN` |

There are about 70+ statement node types covering every SQL command that Postgres supports.

Note: some names don't match the SQL keyword exactly. `CREATE TABLE` produces a `CreateStmt` (not `CreateTableStmt`). `CREATE INDEX` produces an `IndexStmt`. These names come directly from the PostgreSQL C source.

### Expression nodes

These represent values, operators, and computations. They appear wherever a value is expected — `whereClause`, `targetList` values, `HAVING`, function arguments, etc.

| Node | Represents | Example |
|------|-----------|---------|
| `A_Expr` | Operators and comparisons | `a + b`, `x = 1`, `y BETWEEN 1 AND 10` |
| `A_Const` | Literal constants | `42`, `'hello'`, `3.14` |
| `ColumnRef` | Column references | `id`, `users.name`, `*` |
| `FuncCall` | Function calls | `count(*)`, `now()`, `upper(name)` |
| `BoolExpr` | Boolean logic | `x AND y`, `NOT z` |
| `SubLink` | Subqueries in expressions | `WHERE id IN (SELECT ...)` |
| `CaseExpr` | CASE expressions | `CASE WHEN ... THEN ... END` |
| `NullTest` | NULL checks | `IS NULL`, `IS NOT NULL` |
| `CoalesceExpr` | COALESCE | `COALESCE(a, b, c)` |
| `TypeCast` | Type casts | `'2024-01-01'::date` |

### Clause and structural nodes

These represent the building blocks that statements are composed of. They typically don't appear at the top level — they appear as children of statement or expression nodes.

| Node | Represents | Found in |
|------|-----------|----------|
| `ResTarget` | A SELECT target item | `SelectStmt.targetList` |
| `RangeVar` | A table reference | `fromClause`, `InsertStmt.relation` |
| `JoinExpr` | A JOIN clause | `fromClause` |
| `SortBy` | An ORDER BY item | `SelectStmt.sortClause` |
| `Alias` | An alias (AS name) | `RangeVar.alias`, `RangeSubselect.alias` |
| `WithClause` | A WITH (CTE) wrapper | `SelectStmt.withClause` |
| `OnConflictClause` | ON CONFLICT (upsert) | `InsertStmt.onConflictClause` |
| `WindowDef` | A WINDOW definition | `SelectStmt.windowClause` |
| `TypeName` | A type specification | `TypeCast.typeName`, column definitions |
| `Constraint` | A column/table constraint | `CREATE TABLE` column definitions |
| `ColumnDef` | A column definition | `CREATE TABLE` |
| `RangeSubselect` | A subquery in FROM | `fromClause` |

### Primitive value nodes

These wrap simple scalar values. They appear inside other nodes wherever a bare value is needed (operator names, identifier parts, etc.):

| Node | Contains |
|------|----------|
| `String` | `{ sval: "..." }` |
| `Integer` | `{ ival: 42 }` |
| `Float` | `{ fval: "3.14" }` (note: string, not number) |
| `Boolean` | `{ boolval: true }` |
| `A_Star` | Represents `*` (no fields) |

Note: `Float.fval` is a string, not a JavaScript number. This preserves the exact precision from the SQL source.

## Patterns worth knowing

### Lists are arrays of wrapped nodes

Anywhere Postgres uses a `List *` in C, the JSON output uses an array of wrapped nodes. For example, `SelectStmt.targetList` is an array of wrapped `ResTarget` nodes:

```typescript
{
  SelectStmt: {
    targetList: [
      { ResTarget: { name: "id", val: { ColumnRef: { ... } } } },
      { ResTarget: { name: "name", val: { ColumnRef: { ... } } } }
    ]
  }
}
```

Similarly, `A_Expr.name` is an array of wrapped `String` nodes representing the operator name:

```typescript
{
  A_Expr: {
    kind: "AEXPR_OP",
    name: [{ String: { sval: "+" } }],
    lexpr: { ... },
    rexpr: { ... }
  }
}
```

### Enums are strings

Postgres enums are represented as string values in the JSON:

```typescript
// A_Expr.kind
"AEXPR_OP"       // a + b, a = b
"AEXPR_OP_ANY"   // a = ANY(b)
"AEXPR_IN"       // a IN (1, 2, 3)
"AEXPR_LIKE"     // a LIKE 'pattern'
"AEXPR_BETWEEN"  // a BETWEEN x AND y

// BoolExpr.boolop
"AND_EXPR"
"OR_EXPR"
"NOT_EXPR"

// JoinExpr.jointype
"JOIN_INNER"
"JOIN_LEFT"
"JOIN_FULL"
"JOIN_RIGHT"

// SetOperation (SelectStmt.op)
"SETOP_UNION"
"SETOP_INTERSECT"
"SETOP_EXCEPT"
```

### Default values are omitted

Following protobuf 3 semantics, fields with default values (0, false, empty string, empty array) are omitted from the JSON output. This means:

- A `SelectStmt` with no `WHERE` clause won't have a `whereClause` field at all
- A `RangeVar` with `inh: true` (the default for inheritance) may omit the `inh` field
- Empty lists like an unused `distinctClause` are simply absent

Always access fields with optional chaining or check for `undefined`.

### `location` fields track source positions

Most nodes include a `location` field — a byte offset into the original SQL string pointing to where that construct started. Useful for error reporting, source maps, or syntax highlighting. These are zero-based. When `location` is `-1` or absent, the node doesn't have a meaningful source position (e.g. it was synthesized during parse tree construction).

### Constants use a nested value wrapper

`A_Const` uses a nested object to distinguish between value types:

```typescript
// Integer constant: 42
{ A_Const: { ival: { ival: 42 } } }

// String constant: 'hello'
{ A_Const: { sval: { sval: "hello" } } }

// Float constant: 3.14
{ A_Const: { fval: { fval: "3.14" } } }

// NULL
{ A_Const: { isnull: true } }
```

The double nesting (`ival: { ival: 42 }`) comes from the protobuf `oneof` — the outer key selects which variant is active, the inner object contains the actual value. This is a consequence of the wrapping pattern applied consistently.

### Qualified names are lists

Multi-part names like `schema.table` or `schema.function` are represented as arrays of `String` nodes:

```typescript
// Unqualified: users
{ RangeVar: { relname: "users" } }

// Schema-qualified: public.users
{ RangeVar: { schemaname: "public", relname: "users" } }

// Function name: pg_catalog.now
{ FuncCall: { funcname: [{ String: { sval: "pg_catalog" } }, { String: { sval: "now" } }] } }
```

`RangeVar` is special — it has dedicated `schemaname` and `relname` fields. Most other places (function names, operator names, type names) use a list of `String` nodes.

### Column references use `fields`

`ColumnRef` uses a `fields` array that can contain `String` nodes for names and `A_Star` for `*`:

```typescript
// SELECT id
{ ColumnRef: { fields: [{ String: { sval: "id" } }] } }

// SELECT users.id
{ ColumnRef: { fields: [{ String: { sval: "users" } }, { String: { sval: "id" } }] } }

// SELECT *
{ ColumnRef: { fields: [{ A_Star: {} }] } }

// SELECT users.*
{ ColumnRef: { fields: [{ String: { sval: "users" } }, { A_Star: {} }] } }
```

## Reasoning about the tree structure

When you need to figure out what a particular SQL construct looks like in the AST, try this approach:

1. **Parse an example.** Use `pg-parser` to parse a minimal SQL query containing the construct you're interested in, then inspect the output.

2. **Search the Postgres source.** Look up the node struct in [parsenodes.h](https://github.com/postgres/postgres/blob/master/src/include/nodes/parsenodes.h). The struct fields tell you exactly what to expect.

3. **Check the protobuf schema.** The [pg_query.proto](https://github.com/pganalyze/libpg_query/blob/17-6.1.0/protobuf/pg_query.proto) file defines every message with `json_name` annotations that show the exact field names in the JSON output.

4. **Use TypeScript's types.** The generated types will guide you with autocompletion and type errors when accessing fields.

### Example walkthrough

Here's what `SELECT u.id, count(*) FROM users u WHERE u.active = true GROUP BY u.id` looks like:

```typescript
{
  version: 170004,
  stmts: [{
    stmt: {
      SelectStmt: {                    // Statement type
        targetList: [
          {
            ResTarget: {               // First SELECT item
              val: {
                ColumnRef: {           // u.id
                  fields: [
                    { String: { sval: "u" } },
                    { String: { sval: "id" } }
                  ]
                }
              }
            }
          },
          {
            ResTarget: {               // Second SELECT item
              val: {
                FuncCall: {            // count(*)
                  funcname: [{ String: { sval: "count" } }],
                  agg_star: true
                }
              }
            }
          }
        ],
        fromClause: [
          {
            RangeVar: {                // FROM users u
              relname: "users",
              inh: true,
              alias: { aliasname: "u" }
            }
          }
        ],
        whereClause: {
          A_Expr: {                    // WHERE u.active = true
            kind: "AEXPR_OP",
            name: [{ String: { sval: "=" } }],
            lexpr: {
              ColumnRef: {
                fields: [
                  { String: { sval: "u" } },
                  { String: { sval: "active" } }
                ]
              }
            },
            rexpr: {
              A_Const: { boolval: { boolval: true } }
            }
          }
        },
        groupClause: [
          {
            ColumnRef: {               // GROUP BY u.id
              fields: [
                { String: { sval: "u" } },
                { String: { sval: "id" } }
              ]
            }
          }
        ]
      }
    }
  }]
}
```

## TypeScript types

`pg-parser` ships generated TypeScript types for every node in the AST, produced from the same protobuf schema that defines the AST structure. The types are version-specific — each supported Postgres version (15, 16, 17) has its own set of type definitions, since node fields can change between Postgres releases.

When you construct a `PgParser` with a known version, all return types are automatically narrowed:

```typescript
const parser = new PgParser({ version: 17 });
const tree = await unwrapParseResult(parser.parse(sql));
// tree is ParseResult<17>
```

The `Node` type is a union of all possible wrapped node types:

```typescript
type Node =
  | { SelectStmt: SelectStmt }
  | { InsertStmt: InsertStmt }
  | { A_Expr: A_Expr }
  | { ColumnRef: ColumnRef }
  // ... ~260 more variants
```

All node fields are optional in the types (reflecting protobuf 3 semantics where any field can be absent). Use optional chaining or the `assertDefined()` utility when traversing.

For the full list of node types and their fields, see the generated type definitions or refer to the [protobuf schema](https://github.com/pganalyze/libpg_query/blob/17-6.1.0/protobuf/pg_query.proto).
