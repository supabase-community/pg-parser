# Contributing

Guide for contributors working on `@supabase/pg-parser`.

## Overview

pg-parser compiles [libpg_query](https://github.com/pganalyze/libpg_query) (PostgreSQL's SQL parser) to WebAssembly via Emscripten. It supports PG versions 15, 16, and 17 as separate WASM binaries and exposes `parse()` and `deparse()` methods in TypeScript.

## Why Emscripten (not WASI)

WASI would be preferred for its portability and smaller runtime footprint, but PostgreSQL's parser uses `setjmp`/`longjmp` for error handling (its `PG_TRY`/`PG_CATCH` mechanism). WASI has no support for `setjmp`/`longjmp`. Emscripten does — it rewrites them into JavaScript exception handling at compile time, which is the main reason we depend on it.

## Architecture

Three layers: **TypeScript API** → **C bindings** (compiled to WASM) → **libpg_query** + **protobuf-JSON bridge**.

We use `pg_query_parse_protobuf` / `pg_query_deparse_protobuf` (the protobuf API, not the old JSON one). A protobuf-JSON bridge converts between protobuf and the JSON AST that TypeScript consumers work with.

### Parse Flow

```
SQL string
  → [libpg_query]        pg_query_parse_protobuf()    → protobuf binary
  → [protobuf-c]         unpack                       → C message structs
  → [protobuf2json]      protobuf2json_string()       → JSON string
  → [TypeScript]         JSON.parse()                 → ParseResult<Version>
```

### Deparse Flow

```
ParseResult<Version>
  → [TypeScript]         JSON.stringify()              → JSON string
  → [protobuf2json]      json2protobuf_string()        → C message structs
  → [protobuf-c]         pack                          → protobuf binary
  → [libpg_query]        pg_query_deparse_protobuf()   → SQL string
```

### Memory

All WASM memory is managed explicitly. The TypeScript side follows the same pattern for both flows:

1. Encode input string → `_malloc` → copy to WASM heap → call C export → `_free` the input
2. Read result from struct pointers on the heap
3. Free the result struct in a `finally` block (`_free_parse_result` / `_free_deparse_result`)

**Multi-byte string gotcha:** always use `TextEncoder.encode().length` for byte length, never `string.length` (UTF-16 code units).

### Error Handling

- `ParseError` — has `message`, `type` (`'syntax'` | `'semantic'` | `'unknown'`), and `position` (0-based offset into the SQL string)
- `DeparseError` — has `message` only (no position or type, since errors occur on the AST)

### The Protobuf-JSON Bridge

Adapted from [protobuf2json-c](https://github.com/Sannis/protobuf2json-c) with changes for proto3 semantics (the original was proto2-only). Uses a [forked protobuf-c](https://github.com/gregnr/protobuf-c/tree/feat/json_name) that adds `json_name` descriptor support, required because libpg_query's `.proto` uses `json_name` annotations for PascalCase node names.

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
