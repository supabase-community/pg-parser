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

const parser = new PgParser();

// Parse a SQL query
const sql = 'SELECT * FROM users WHERE id = 1';
const ast = await parser.parse(sql);

console.log(ast);
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
  const parser = new PgParser({ version: '15' }); // Use Postgres 15 for parsing
  ```

### `parse()` method

To parse a SQL query, use the `parse` method:

```typescript
const sql = 'SELECT * FROM users WHERE id = 1';
const result = await parser.parse(sql);
```

This returns a `PgParserResult` object. If the parse was successful, `PgParserResult` will contain the following properties:

- `tree`: The abstract syntax tree (AST) of the parsed SQL query.
- `stderrBuffer`: The standard error buffer from the Postgres parser (can contain extra information about the parse).

If the parse failed, `PgParserResult` will contain the following properties:

- `error`: The error message from the Postgres parser.

Use the `error` property to check if the parse was successful:

```typescript
if (result.error) {
  console.error('Parse error:', result.error);
} else {
  console.log('Parsed AST:', result.tree);
}
```

TypeScript will correctly narrow the type of `result` based on whether there was an error or not.

If you prefer throwing an error instead of returning a result object, you can wrap `parse` in the `unwrapResult` helper:

```typescript
import { PgParser, unwrapResult } from '@supabase/pg-parser';
const parser = new PgParser();
const sql = 'SELECT * FROM users WHERE id = 1';
const tree = await unwrapResult(parser.parse(sql)); // Throws an error if the parse failed
console.log('Parsed AST:', tree);
```

### `tree` object

The `tree` AST is a JavaScript object that represents the structure of the SQL query.

```typescript
const tree = await unwrapResult(parser.parse('SELECT 1+1 as sum'));

console.log(tree);
```

The output will be an object that looks like this:

```typescript
{
  tree: {
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
  },
}
```

This object will be of type `ParseResult` and will contain types for all nodes in the AST.

Note that this type can vary slightly between Postgres versions. If you are dynamically passing a version to `PgParser` at runtime (e.g. based on your user's database version), `parse()` will return a `ParseResult` type that is a union of all possible versions since we don't know which version will be used at runtime.

```typescript
const version = await getPostgresVersion();
const parser = new PgParser({ version });

const sql = 'SELECT * FROM users WHERE id = 1';
const result = await unwrapResult(parser.parse(sql));

// Result will be of type ParseResult<15> | ParseResult<16> | ParseResult<17>
```

Otherwise if you know the version at compile time, `parse()` will return the `ParseResult` type specific to that version.

```typescript
const parser = new PgParser({ version: '16' });
const sql = 'SELECT * FROM users WHERE id = 1';
const result = await unwrapResult(parser.parse(sql));

// Result will be of type ParseResult<16>
```

```typescript
const parser = new PgParser();
const sql = 'SELECT * FROM users WHERE id = 1';
const result = await unwrapResult(parser.parse(sql));

// Result will be of type ParseResult<17>
```

## Roadmap

- [ ] Deparse SQL queries (AST -> SQL)
- [ ] Expose Postgres scanner (lexer)

## License

MIT
