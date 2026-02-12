# Exploration: Idiomatic TypeScript AST

An exploration of replacing the current node wrapping pattern with a more idiomatic TypeScript discriminated union.

## Current shape (wrapped)

Every polymorphic node is an object with a single key — the type name:

```typescript
{ SelectStmt: { targetList: [...], fromClause: [...] } }
```

To discriminate, you check the key:

```typescript
if ('SelectStmt' in stmt) { ... }
// or
const { type, node } = unwrapNode(stmt);
```

## Desired shape (flat discriminated union)

A `type` field on the node itself:

```typescript
{ type: 'SelectStmt', targetList: [...], fromClause: [...] }
```

Standard TS pattern — works with `switch`, narrowing, exhaustiveness checks:

```typescript
switch (stmt.type) {
  case 'SelectStmt':
    stmt.targetList; // TS knows this exists
    break;
}
```

## Why the wrapping exists

Traced through the full pipeline:

| Layer | Representation | Wrapping? |
|-------|---------------|-----------|
| **Postgres C** | `NodeTag type` as first field of every struct, `Node *` pointers for polymorphism | **No** — the C source uses exactly the flat `type` field pattern we'd prefer |
| **libpg_query protobuf** | `message Node { oneof node { SelectStmt select_stmt = 100; ... } }` | Structural — the `oneof` encodes the discriminator |
| **protobuf → JSON** | Only the active `oneof` field appears as a key: `{ "SelectStmt": { ... } }` | **Yes** — the wrapping becomes visible here |

The wrapping is a protobuf serialization artifact. PostgreSQL's own C code uses `NodeTag type` — a discriminator field on the struct itself — which is exactly the pattern we'd want in TypeScript. libpg_query chose `oneof` (the standard protobuf idiom for tagged unions), and protobuf's JSON mapping turns that into the single-key wrapper object.

## Where to intervene

There are four realistic approaches, each intervening at a different layer.

### Option A: Transform in the C protobuf2json bridge

Modify `protobuf2json_process_message()` in `bindings/protobuf2json/protobuf2json.c` to emit `{ "type": "SelectStmt", ...fields }` instead of `{ "SelectStmt": { ...fields } }` when serializing a `oneof`.

The active-variant handling is at lines ~229-240 (checks `PROTOBUF_C_FIELD_FLAG_ONEOF`). Currently it emits the active variant's json_name as a key with the sub-message as the value. To flatten, it would need to:

1. Add a `"type"` key set to the json_name string
2. Merge the sub-message fields into the parent object instead of nesting

The reverse direction (`json2protobuf_process_message()`) would need symmetric changes: read the `"type"` key, look up the corresponding field descriptor, and reconstruct the oneof from the remaining keys.

**Pros:**
- Best performance — zero JS overhead, the JSON string already arrives in the desired shape
- Smaller JSON strings (less nesting) → faster `JSON.parse()`
- Symmetric — both parse and deparse paths are handled

**Cons:**
- Modifying a generic protobuf-to-JSON serializer for a domain-specific need
- Must special-case `Node` (or all oneofs) — currently the serializer is schema-agnostic
- Risk of field name collision if any node ever has a field called `type` (none do today, but fragile)
- Requires maintaining the forked protobuf2json code through upstream changes
- Higher implementation risk — C memory management, edge cases

### Option B: Transform in JS after JSON.parse / before JSON.stringify

Add a recursive tree transform in `pg-parser.ts` immediately after `JSON.parse()` (for parse) and before `JSON.stringify()` (for deparse).

In the parse path (~line 164):
```typescript
const rawTree = JSON.parse(readString(module.HEAP8, parseTreePtr));
const tree = wrapToFlat(rawTree);  // recursive transform
```

In the deparse path (~line 202):
```typescript
const rewrapped = flatToWrap(parseResult);  // recursive re-wrap
const json = JSON.stringify(rewrapped);
```

The transform needs to know which objects are `Node` wrappers. Two strategies:
- **Schema-aware:** maintain a set of all node type names (~260 strings) and check if a single-key object's key is in the set
- **Heuristic:** any object with exactly one key whose value is a non-null object is a wrapped node (could false-positive on sparse messages, but in practice works)

**Pros:**
- No C changes — purely additive JS
- Easy to test, iterate, and make optional
- Can ship behind a flag initially

**Cons:**
- Double traversal cost — `JSON.parse()` walks the string once, the transform walks the object tree again
- For round-trips (parse → modify → deparse), the cost doubles again (unwrap + re-wrap)
- Memory churn — creates new objects for every node, GC pressure
- For typical queries (~50-200 nodes): sub-millisecond, negligible
- For large SQL (~10,000+ nodes): could add 1-5ms, noticeable but unlikely to bottleneck

### Option C: Transform only at the type level (zero runtime cost)

Keep the JSON shape as-is. Generate TypeScript types that present the *illusion* of a flat discriminated union through mapped/conditional types, while the runtime objects remain wrapped.

Something like:

```typescript
// Generated per node type:
interface SelectStmtNode {
  type: 'SelectStmt';
  targetList?: Node[];
  fromClause?: Node[];
  whereClause?: Node;
  // ...
}

// The Node union:
type Node = SelectStmtNode | InsertStmtNode | ColumnRefNode | ...

// But the actual runtime access still requires:
//   (stmt as any).SelectStmt.targetList
// which defeats the purpose
```

This doesn't actually work — the types would lie about the runtime shape, which is worse than useless.

**Verdict: not viable.** The whole point is to change the runtime shape.

### Option D: Proxy-based lazy transform

Use `Proxy` objects to present a flat interface while the underlying data stays wrapped. When you access `stmt.type`, the proxy reads the single key. When you access `stmt.targetList`, it forwards to `stmt.SelectStmt.targetList`.

```typescript
function flatProxy(wrapped) {
  const [type] = Object.keys(wrapped);
  const inner = wrapped[type];
  return new Proxy(inner, {
    get(target, prop) {
      if (prop === 'type') return type;
      return target[prop];
    }
  });
}
```

**Pros:**
- No upfront transform cost — lazy
- The underlying data stays in wrapped format, so deparse needs no re-wrapping
- Could be applied selectively

**Cons:**
- Proxies are significantly slower than plain object access (5-20x per property access in most engines)
- Breaks `JSON.stringify()` — the proxy wouldn't serialize correctly for deparse
- Every property access on every node in every traversal pays the proxy overhead
- Debugging is harder — proxies obscure the actual data in devtools
- Complex to type correctly in TypeScript

**Verdict: not practical** for a hot-path data structure.

## Recommended approach

**Option B (JS-level transform)** is the best balance of effort, safety, and ergonomics. Here's why:

- Option A (C-level) has the best performance but the highest implementation risk and maintenance burden. The protobuf2json bridge is already a fork of an upstream library, and making it schema-aware adds fragility.
- Option B's performance cost is negligible for realistic query sizes and avoidable for the deparse path (see API design below).
- Options C and D don't actually work.

## API design

The key insight: expose the flat format as the primary API, keep the wrapped format available for backwards compatibility and for deparse.

### Approach 1: Two parse methods

```typescript
const parser = new PgParser();

// New primary API — flat nodes with `type` discriminator
const tree = await parser.parse(sql);
// tree.stmts[0].stmt.type === 'SelectStmt'
// tree.stmts[0].stmt.targetList === [...]

// Backwards-compatible — original wrapped format
const tree = await parser.parseRaw(sql);
// tree.stmts[0].stmt === { SelectStmt: { targetList: [...] } }
```

For deparse, the flat tree needs re-wrapping:

```typescript
// Accepts flat format (re-wraps internally)
await parser.deparse(flatTree);

// Accepts raw wrapped format directly (no transform)
await parser.deparseRaw(wrappedTree);
```

### Approach 2: Format option on constructor

```typescript
// New default — flat
const parser = new PgParser({ format: 'flat' });
const tree = await parser.parse(sql);  // flat nodes

// Wrapped for backwards compat
const parser = new PgParser({ format: 'wrapped' });
const tree = await parser.parse(sql);  // wrapped nodes (current behavior)
```

This is cleaner but harder to type — the `ParseResult` type varies based on a runtime option.

### Approach 3: Standalone transform utilities

Leave the parser output as-is. Export transform functions:

```typescript
import { toFlat, toWrapped } from '@supabase/pg-parser';

const { tree } = await parser.parse(sql);
const flat = toFlat(tree);   // recursive transform to flat format
// flat.stmts[0].stmt.type === 'SelectStmt'

// Before deparse
const wrapped = toWrapped(flat);
await parser.deparse(wrapped);
```

This is the least invasive — no changes to the core parse/deparse API.

## Type generation

Regardless of which API approach, we need TypeScript types for the flat format. Two paths:

### Fork/extend pg-proto-parser

`pg-proto-parser` currently supports `wrappedNodeTypeExport: true | false`. Neither produces what we want. We'd need a third mode that generates:

```typescript
export interface SelectStmt {
  type: 'SelectStmt';
  targetList?: Node[];
  fromClause?: Node[];
  whereClause?: Node;
  // ... all other fields
}

export type Node = SelectStmt | InsertStmt | UpdateStmt | ... ;
```

Each interface gets a `type` literal field. The `Node` union becomes a standard discriminated union. This would require either:
- Contributing the option upstream to `pg-proto-parser`
- Forking `pg-proto-parser` (it's from launchql/pgsql-parser)
- Writing a post-processing script that takes the existing generated types and adds the `type` field

### Generate types ourselves

Replace `pg-proto-parser` with our own type generator that reads `pg_query.proto` directly. We already have the proto file vendored via libpg_query. A custom generator gives full control over the output shape and removes an external dependency.

The current generator script (`scripts/generate-types.ts`) is just 47 lines wrapping `pg-proto-parser`. A custom one would be more code but not dramatically so — the proto file is structurally simple (flat list of messages with scalar/message/enum/repeated fields).

## What changes at each layer

Summary of touch points for Option B + Approach 1:

| Component | Change |
|-----------|--------|
| `pg-parser.ts` parse path | Add `wrapToFlat()` transform after `JSON.parse()` |
| `pg-parser.ts` deparse path | Add `flatToWrap()` transform before `JSON.stringify()` |
| `pg-parser.ts` API | Add `parseRaw()` / `deparseRaw()` for backwards compat |
| Type generation | Generate flat node types with `type` discriminator field |
| `util.ts` | `unwrapNode()` still useful for raw format; add flat-format utilities |
| `types/index.ts` | Export both `Node` (flat) and `WrappedNode` (legacy) |
| C bindings | No changes |
| Tests | Duplicate tests for both formats, or parameterize |

## Open questions

1. **Naming the `type` field.** Should it be `type`, `nodeType`, `kind`, or `_type`? `type` is the most natural but could theoretically collide with future Postgres fields (no current collision). `nodeType` is safer but verbose.

2. **Where does `type` live for non-Node messages?** Direct message fields like `RangeVar.alias: Alias` aren't wrapped today and don't need a `type` field. Only `Node`-typed positions need the discriminator. This is important — the transform only applies to `Node` wrappers, not to every nested object.

3. **Should the flat format be the v1.0 default?** This would be a breaking change. Could be gated behind a major version bump.

4. **Performance budget.** Is the JS transform overhead acceptable for large SQL? The existing memory leak tests parse 1000 iterations — the transform should be benchmarked similarly.

5. **Do we need both formats at runtime?** Or is it sufficient to export the transform as a utility and let consumers choose? Baking it into the parser class adds API surface.
