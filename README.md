# pg-parser

Postgres SQL parser that can run anywhere (Browser, Node.js, Deno, Bun, etc.).

## Features

- **Parse:** Parses Postgres SQL queries into an abstract syntax tree (AST)
- **Deparse:** Converts an AST back into a SQL string
- **Accurate:** Uses real Postgres C code compiled to WASM
- **Multi-version:** Supports multiple Postgres versions at runtime (15, 16, 17)
- **Multi-runtime:** Works on any modern JavaScript runtime (Browser, Node.js, Deno, Bun, etc.)

## Why?

There are other great JavaScript Postgres SQL parsers, but we wanted a few missing features:

- **Multi-version support:** We wanted to be able to parse SQL queries for different Postgres versions at runtime, not just compile time. This means we can dynamically adapt to a user's Postgres version without needing to install multiple versions of the same package.
- **WASM-based:** We wanted the parser to be portable across all JavaScript runtimes, including the browser, Node.js, Deno, and Bun. This allows us to use the same parser code in both client-side and server-side applications without worrying about compatibility issues or problems installing native dependencies.

## Installation

```bash
npm install @supabase/pg-parser
```

```bash
yarn add @supabase/pg-parser
```

```bash
pnpm add @supabase/pg-parser
```

## Usage

### Parse SQL to AST

```typescript
import { PgParser } from '@supabase/pg-parser';

const parser = new PgParser(); // Defaults to latest version (17)

const { tree } = await parser.parse('SELECT * FROM users WHERE id = 1');

console.log(tree);

// { version: 170004, stmts: [ ... ] }
```

### Deparse AST to SQL

```typescript
import { PgParser } from '@supabase/pg-parser';

const parser = new PgParser();

// Parse SQL into an AST
const { tree } = await parser.parse('SELECT * FROM users WHERE id = 1');

// { version: 170004, stmts: [ ... ] }

// Deparse the AST back into SQL
const { sql } = await parser.deparse(tree);

console.log(sql);

// SELECT * FROM users WHERE id = 1
```

## API

### `PgParser` class

First create a new instance of `PgParser`:

```typescript
import { PgParser } from '@supabase/pg-parser';
const parser = new PgParser();
```

`PgParser` accepts an `options` object which can contain the following:

- `version`: The Postgres version to use for parsing. Valid versions are `15`, `16`, or `17`. Defaults to the latest version (`17`).

  ```typescript
  const parser = new PgParser({ version: 15 }); // Use Postgres 15 parser
  ```

### `parse()` method

To parse a SQL query, use the `parse()` method:

```typescript
const sql = 'SELECT * FROM users WHERE id = 1';
const result = await parser.parse(sql);
```

This returns a `WrappedParseResult` object. If the parse was successful, `WrappedParseResult` will contain a `tree` property containing the abstract syntax tree (AST) of the parsed SQL query.

If the parse failed, `WrappedParseResult` will contain an `error` property with the error message from the Postgres parser.

Use the `error` property to check if the parse was successful:

```typescript
if (result.error) {
  console.error('Parse error:', result.error);
} else {
  console.log('Parsed AST:', result.tree);
}
```

TypeScript will correctly narrow the type of `result` based on whether there was an error or not.

If you prefer throwing an error instead of returning a result object, you can wrap `parse()` in the `unwrapParseResult()` helper:

```typescript
import { PgParser, unwrapParseResult } from '@supabase/pg-parser';
const parser = new PgParser();
const sql = 'SELECT * FROM users WHERE id = 1';
const tree = await unwrapParseResult(parser.parse(sql)); // Throws an error if the parse failed
console.log('Parsed AST:', tree);
```

### `deparse()` method

To convert an AST back into a SQL string, use the `deparse()` method:

```typescript
const { tree } = await parser.parse('SELECT * FROM users WHERE id = 1');
const result = await parser.deparse(tree);
```

This returns a `WrappedDeparseResult` object. If the deparse was successful, `WrappedDeparseResult` will contain a `sql` property containing the reconstructed SQL string.

If the deparse failed, `WrappedDeparseResult` will contain an `error` property with the error message.

Use the `error` property to check if the deparse was successful:

```typescript
if (result.error) {
  console.error('Deparse error:', result.error);
} else {
  console.log('SQL:', result.sql);
}
```

TypeScript will correctly narrow the type of `result` based on whether there was an error or not.

If you prefer throwing an error instead of returning a result object, you can wrap `deparse()` in the `unwrapDeparseResult()` helper (see [Utility functions](#utility-functions)).

#### Modifying the AST

One of the most useful applications of deparse is modifying SQL programmatically. You can parse a query, modify the AST, and then deparse it back into SQL:

```typescript
import { PgParser, unwrapNode } from '@supabase/pg-parser';

const parser = new PgParser();

// Parse the original query
const { tree } = await parser.parse('SELECT 1 + 1');

// Modify the AST: add an alias to the expression
const { node: selectStmt } = unwrapNode(tree.stmts[0].stmt);
const { node: resTarget } = unwrapNode(selectStmt.targetList[0]);
resTarget.name = 'total';

// Deparse the modified AST back into SQL
const { sql } = await parser.deparse(tree);

console.log(sql);

// SELECT 1 + 1 AS total
```

### `tree` object

The `tree` AST is a JavaScript object that represents the structure of the SQL query.

```typescript
const tree = await unwrapParseResult(parser.parse('SELECT 1+1 as sum'));

console.log(tree);
```

The output will be an object that looks like this:

```typescript
{
  version: 170004,
  stmts: [
    {
      stmt: {
        SelectStmt: {
          targetList: [
            {
              ResTarget: {
                name: 'sum',
                val: {
                  A_Expr: {
                    kind: 'AEXPR_OP',
                    lexpr: { A_Const: { ival: { ival: 1 } } },
                    name: [{ String: { sval: '+' } }],
                    rexpr: { A_Const: { ival: { ival: 1 } } },
                  },
                },
              },
            },
          ],
        },
      },
    },
  ],
}
```

This object will be of type `ParseResult` and will contain types for all nodes in the AST. Note that this type can vary slightly between Postgres versions. `PgParser` will automatically detect the version of Postgres you are using and return the correct type at compile time.

```typescript
const parser = new PgParser({ version: 16 });
const sql = 'SELECT * FROM users WHERE id = 1';
const result = await unwrapParseResult(parser.parse(sql));

// Result will be of type ParseResult<16>
```

If you are dynamically passing a version to `PgParser` at runtime (e.g. based on your user's database version), `parse()` will return a `ParseResult` type that is a union of all possible versions since we don't know which version will be used at compile time.

```typescript
const version = await getMyPostgresVersion(); // Your logic to get the version
const parser = new PgParser({ version });

const sql = 'SELECT * FROM users WHERE id = 1';
const result = await unwrapParseResult(parser.parse(sql));

// Result will be of type ParseResult<15> | ParseResult<16> | ParseResult<17>
```

Most AST nodes are the same across versions, but if there is version-specific parsing logic you need to handle, use the `isParseResultVersion()` type guard to narrow the type of `result` based on the version:

```typescript
import {
  PgParser,
  isParseResultVersion,
  unwrapParseResult,
} from '@supabase/pg-parser';

const version = await getMyPostgresVersion(); // Your logic to get the version
const parser = new PgParser({ version });

const sql = 'SELECT * FROM users WHERE id = 1';
const result = await unwrapParseResult(parser.parse(sql));

if (isParseResultVersion(result, 17)) {
  // Result is now of type ParseResult<17>
  // Handle Postgres 17 specific logic
}
```

`PgParser` will throw an error if you pass an unsupported version. You can also use `isSupportedVersion()` to manually check if a version is supported:

```typescript
import { isSupportedVersion } from '@supabase/pg-parser';

const version = await getMyPostgresVersion();

if (!isSupportedVersion(version)) {
  throw new Error(`unsupported version: ${version}`);
}

// `version` is supported, and its type has been narrowed to `15 | 16 | 17`
console.log(version);
```

Use the `getSupportedVersions()` function to get a list of all supported versions:

```typescript
import { getSupportedVersions } from '@supabase/pg-parser';

const supportedVersions = getSupportedVersions();

console.log(supportedVersions); // [15, 16, 17]
```

### Parse `error` object

If the parse fails, `PgParser` will return an `error` of type `ParseError` with the following properties:

- `message`: A human-readable error message. (e.g., `syntax error at or near "FROM"`).

- `type`: The type of parse error. Possible values are:

  - `syntax`: A lexical or syntactic error, such as mismatched parentheses,
    unterminated quotes, invalid tokens, or incorrect SQL statement structure.
    Most SQL errors will fall into this category.
  - `semantic`: These are rare, but can occur during specific validations like
    numeric range checking (e.g., column numbers must be between 1 and 32767
    in `ALTER INDEX` statements).
  - `unknown`: An unknown error type, typically representing an internal parser error.

  **Note:** The vast majority of semantic validation (type checking, schema validation,
  constraint validation, etc.) happens after parsing and is not represented in these error types.

- `position`: The position of the error in the SQL string. This is a zero-based index, so the first character is at position 0. Points to the character where the error was detected.

  **Note:** This is relative to the entire SQL string, not just the statement being parsed or line numbers within a statement. If you are parsing a multi-statement query, the position will be relative to the entire query string, where newlines are counted as single characters.

### Deparse `error` object

If the deparse fails, `PgParser` will return an `error` of type `DeparseError` with the following property:

- `message`: A human-readable error message describing what went wrong.

Unlike `ParseError`, deparse errors don't have a `position` or `type` since they operate on an AST rather than a SQL string. Deparse errors typically occur when the AST contains invalid structure, such as a wrong type for a field (e.g. passing a string where an array is expected).

### Utility functions

The following utility functions are available:

#### `unwrapParseResult()`

Unwraps a `WrappedParseResult` by throwing an error if the result contains an `error`, or otherwise returning the parsed `tree`. Supports both synchronous and asynchronous results.

```typescript
import { PgParser, unwrapParseResult } from '@supabase/pg-parser';
const parser = new PgParser();
const tree = await unwrapParseResult(parser.parse('SELECT 1'));
```

#### `unwrapDeparseResult()`

Unwraps a `WrappedDeparseResult` by throwing an error if the result contains an `error`, or otherwise returning the deparsed SQL string. Supports both synchronous and asynchronous results.

```typescript
import {
  PgParser,
  unwrapParseResult,
  unwrapDeparseResult,
} from '@supabase/pg-parser';
const parser = new PgParser();
const tree = await unwrapParseResult(parser.parse('SELECT 1'));
const sql = await unwrapDeparseResult(parser.deparse(tree));
```

#### `unwrapNode()`

Extracts the node type and nested value while preserving type information.

```typescript
import { unwrapNode } from '@supabase/pg-parser';

const wrappedStatement = result.tree.stmts[0].stmt;
// { SelectStmt: { ... } }

const { type, node } = unwrapNode(wrappedStatement);
// { type: 'SelectStmt', node: { ... } }
```

**Background:** The AST structure produced by Postgres ([libpg_query](https://github.com/pganalyze/libpg_query)) can be complex due to nesting. For example, a `SELECT` statement is represented as:

```typescript
{
  version: 170004,
  stmts: [
    {
      stmt: {
        SelectStmt: {
          targetList: [ ... ],
          fromClause: [ ... ],
          whereClause: { ... },
          ...
        }
      }
    }
  ]
}
```

In order to determine which statement type is being parsed, you'd have to use the `in` operator to check for the presence of a specific key:

```typescript
const wrappedStatement = result.tree.stmts[0].stmt;
// e.g. { SelectStmt: { ... } }

if ('SelectStmt' in wrappedStatement) {
  // It's a SELECT statement
  const selectStmt = wrappedStatement.SelectStmt;
} else if ('InsertStmt' in wrappedStatement) {
  // It's an INSERT statement
  const insertStmt = wrappedStatement.InsertStmt;
} else if ('UpdateStmt' in wrappedStatement) {
  // It's an UPDATE statement
  const updateStmt = wrappedStatement.UpdateStmt;
} else if ('DeleteStmt' in wrappedStatement) {
  // It's a DELETE statement
  const deleteStmt = wrappedStatement.DeleteStmt;
}
```

`unwrapNode()` simplifies this by extracting the node type and nested value in a single step:

```typescript
const { type, node } = unwrapNode(wrappedStatement);
```

You can then use `type` to determine which statement it is and narrow the type of `node` accordingly:

```typescript
const { type, node } = unwrapNode(wrappedStatement);

switch (type) {
  case 'SelectStmt':
    // Now `node` is narrowed to `SelectStmt`
    break;
  case 'InsertStmt':
    // Now `node` is narrowed to `InsertStmt`
    break;
  case 'UpdateStmt':
    // Now `node` is narrowed to `UpdateStmt`
    break;
  case 'DeleteStmt':
    // Now `node` is narrowed to `DeleteStmt`
    break;
}
```

## Roadmap

- [x] Parse SQL queries (SQL -> AST)
- [x] Deparse SQL queries (AST -> SQL)
- [ ] Expose Postgres scanner (lexer)
- [ ] Version compatibility checks

## License

MIT
