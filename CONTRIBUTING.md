# Contributing

Guide for contributors working on `@supabase/pg-parser`.

## Overview

pg-parser compiles [libpg_query](https://github.com/pganalyze/libpg_query) (PostgreSQL's SQL parser) to WebAssembly via Emscripten. It supports PG versions 15, 16, and 17 as separate WASM binaries and exposes `parse()`, `deparse()`, and `scan()` methods in TypeScript. `deparse()` accepts both full `ParseResult` objects and individual AST `Node`s (for producing SQL fragments).

## Why Emscripten (not WASI)

WASI would be preferred for its portability and smaller runtime footprint, but PostgreSQL's parser uses `setjmp`/`longjmp` for error handling (its `PG_TRY`/`PG_CATCH` mechanism). This requires stack unwinding/rewinding, which WASI has no support for. Emscripten does — it rewrites `setjmp`/`longjmp` into JavaScript exception handling at compile time, which is the main reason we depend on it.

## Architecture

Three layers: **TypeScript API** → **C bindings** (compiled to WASM) → **libpg_query** + **protobuf-JSON bridge**.

We use `pg_query_parse_protobuf` / `pg_query_deparse_protobuf` (the protobuf API, not the JSON one). A protobuf-JSON bridge converts between protobuf and the JSON AST that TypeScript consumers work with.

### Parse Flow

```
SQL string
  → [libpg_query]        pg_query_parse_protobuf()    → protobuf binary
  → [protobuf-c]         unpack                       → C message structs
  → [protobuf2json]      protobuf2json_string()       → JSON string
  → [TypeScript]         JSON.parse()                 → ParseResult<Version>
```

### Deparse Flow

`deparse()` accepts either a full `ParseResult` or an individual `Node`. TypeScript detects which via `'stmts' in input || 'version' in input` and routes to the appropriate C export.

**Full statement deparse** (`_deparse_sql`):

```
ParseResult<Version>
  → [TypeScript]         JSON.stringify()              → JSON string
  → [protobuf2json]      json2protobuf_string()        → C message structs
  → [protobuf-c]         pack                          → protobuf binary
  → [libpg_query]        pg_query_deparse_protobuf()   → SQL string
```

**Per-node deparse** (`_deparse_node`):

```
Node<Version>
  → [TypeScript]         JSON.stringify()              → JSON string
  → [protobuf2json]      json_to_protobuf_node()       → C message structs (pg_query__node__descriptor)
  → [protobuf-c]         pack                          → protobuf binary
  → [libpg_query]        pg_query_deparse_node_protobuf()
      → pg_query_protobuf_to_node()                    → internal Node*
      → deparseNode()                                  → SQL fragment
```

`deparseNode()` is a flat switch that dispatches each node type to its specific handler: expressions route to `deparseExpr()`, clause types call their handler directly (e.g. `deparseColumnRef`, `deparseFuncCall`), and statements fall through to `deparseStmt()`.

Both paths reuse the same result struct and cleanup (`_free_deparse_result`).

### Memory

All WASM memory is managed explicitly. The TypeScript side follows the same pattern for both flows:

1. Encode input string → `_malloc` → copy to WASM heap → call C export → `_free` the input
2. Read result from struct pointers on the heap
3. Free the result struct in a `finally` block (`_free_parse_result` / `_free_deparse_result`)

**Multi-byte string gotcha:** always use `TextEncoder.encode().length` for byte length, never `string.length` (UTF-16 code units).

### Error Handling

- `ParseError` — has `message`, `type` (`'syntax'` | `'semantic'` | `'unknown'`), and `position` (0-based offset into the SQL string)
- `DeparseError` — has `message` only (no position or type, since errors occur on the AST)

### libpg_query Patches

Per-node deparse requires calling internal libpg_query functions (`deparseExpr`, `_readNode`, etc.) that are `static` — not accessible from our C bindings. We work around this by appending new functions to libpg_query source files via patch files in `bindings/patches/`. The Makefile applies these automatically after cloning the vendored source.

**Patch files:**

- `deparse_node_15_16.c` — `deparseNode()` switch for PG 15/16 (2-param `deparseExpr`)
- `deparse_node_17.c` — `deparseNode()` switch for PG 17 (3-param `deparseExpr` + JSON expression types)
- `deparse_node_entry.c` — `pg_query_deparse_node_protobuf()` entry point (version-agnostic)
- `read_node_public.c` — `pg_query_protobuf_to_node()` wrapper around static `_readNode()` (version-agnostic)

**Brittleness:** patches are append-only (`cat >>`), so they can't conflict with upstream changes to existing lines. The only maintenance trigger is bumping the libpg_query version tag (e.g. PG 18), which would require checking for changed handler signatures and creating a new version-specific patch file.

### The Protobuf-JSON Bridge

The protobuf-JSON conversion happens in C (inside WASM) rather than in JavaScript. A JS-based protobuf library (e.g. protobuf.js) would add significant bundle size, and libpg_query already vendors protobuf-c for its own serialization — so we reuse that and just add a thin JSON layer on top.

It was adapted from [protobuf2json-c](https://github.com/Sannis/protobuf2json-c) with changes for proto3 semantics (the original was proto2-only). Uses a [forked protobuf-c](https://github.com/gregnr/protobuf-c/tree/feat/json_name) that adds `json_name` descriptor support, required because libpg_query's `.proto` uses `json_name` annotations for node names.

## Development

### Prerequisites

- [Docker](https://www.docker.com/) (for the Emscripten toolchain)
- [pnpm](https://pnpm.io/) (v10+)
- Node.js 18+

### Building

```bash
pnpm install

# Build everything (WASM for all PG versions + JS bundle)
pnpm build

# Build a single PG version's WASM
pnpm --filter @supabase/pg-parser make:17 build

# Rebuild JS only (after WASM is already built)
pnpm --filter @supabase/pg-parser build:js
```

The WASM build runs inside Docker via `docker compose run --rm emsdk emmake make`. Most of the build logic lives in `packages/pg-parser/Makefile` — vendoring libpg_query and jansson, patching protobuf-c for `json_name` support, compiling the C bindings, and linking the final WASM binary. Vendor dependencies are cloned on first build.

### Testing

```bash
# All tests (Node, Vercel Edge, Chromium, WebKit, Firefox)
pnpm test

# Node only
pnpm --filter @supabase/pg-parser test:unit:node

# Browser only
pnpm --filter @supabase/pg-parser test:unit:browser
```
