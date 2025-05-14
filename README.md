# pg-parser

Postgres SQL parser that can run anywhere (Browser, Node.js, Deno, Bun, etc.).

## Features

- **AST:** Parses Postgres SQL queries into an abstract syntax tree (AST)
- **WASM:** Uses real Postgres C code compiled to WASM
- **Multi-version:** Supports multiple Postgres versions at runtime (15, 16, 17)
- **Multi-runtime:** Works on any modern JavaScript runtime (Browser, Node.js, Deno, Bun, etc.)

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

```typescript
import { PgParser } from '@supabase/pg-parser';

const parser = new PgParser(); // Defaults to latest version (17)

// Parse a SQL query
const result = await parser.parse('SELECT * FROM users WHERE id = 1');

console.log(result);
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

To parse a SQL query, use the `parse` method:

```typescript
const sql = 'SELECT * FROM users WHERE id = 1';
const result = await parser.parse(sql);
```

This returns a `PgParserResult` object. If the parse was successful, `PgParserResult` will contain a `tree` property containing the abstract syntax tree (AST) of the parsed SQL query.

If the parse failed, `PgParserResult` will contain an `error` property with the error message from the Postgres parser.

Use the `error` property to check if the parse was successful:

```typescript
if (result.error) {
  console.error('Parse error:', result.error);
} else {
  console.log('Parsed AST:', result.tree);
}
```

TypeScript will correctly narrow the type of `result` based on whether there was an error or not.

If you prefer throwing an error instead of returning a result object, you can wrap `parse` in the `unwrapParserResult` helper:

```typescript
import { PgParser, unwrapParserResult } from '@supabase/pg-parser';
const parser = new PgParser();
const sql = 'SELECT * FROM users WHERE id = 1';
const tree = await unwrapParserResult(parser.parse(sql)); // Throws an error if the parse failed
console.log('Parsed AST:', tree);
```

### `tree` object

The `tree` AST is a JavaScript object that represents the structure of the SQL query.

```typescript
const tree = await unwrapParserResult(parser.parse('SELECT 1+1 as sum'));

console.log(tree);
```

The output will be an object that looks like this:

```typescript
{
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
                    lexpr: {
                      A_Const: {
                        ival: {
                          ival: 1,
                        },
                      },
                    },
                    name: [
                      {
                        String: {
                          sval: '+',
                        },
                      },
                    ],
                    rexpr: {
                      A_Const: {
                        ival: {
                          ival: 1,
                        },
                      },
                    },
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
const result = await unwrapParserResult(parser.parse(sql));

// Result will be of type ParseResult<16>
```

If you are dynamically passing a version to `PgParser` at runtime (e.g. based on your user's database version), `parse()` will return a `ParseResult` type that is a union of all possible versions since we don't know which version will be used at compile time.

```typescript
const version = await getPostgresVersion();
const parser = new PgParser({ version });

const sql = 'SELECT * FROM users WHERE id = 1';
const result = await unwrapParserResult(parser.parse(sql));

// Result will be of type ParseResult<15> | ParseResult<16> | ParseResult<17>
```

Most AST nodes are the same across versions, but if there is version-specific parsing logic you need to handle, use the `isParseResultVersion()` type guard to narrow the type of `result` based on the version:

```typescript
import { PgParser, isParseResultVersion } from '@supabase/pg-parser';

const version = await getMyPostgresVersion();
const parser = new PgParser({ version });

const sql = 'SELECT * FROM users WHERE id = 1';
const result = await unwrapParserResult(parser.parse(sql));

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

Use the `SUPPORTED_VERSIONS` constant to get a list of all supported versions:

```typescript
import { SUPPORTED_VERSIONS } from '@supabase/pg-parser';

console.log(SUPPORTED_VERSIONS); // [15, 16, 17]
```

## Roadmap

- [ ] Deparse SQL queries (AST -> SQL)
- [ ] Expose Postgres scanner (lexer)

## License

MIT
