import {
  DeparseError,
  getParseErrorType,
  ParseError,
  type ParseErrorType,
  ScanError,
  type ScanErrorType,
} from './errors.js';
import type {
  KeywordKind,
  MainModule,
  Node,
  ParseResult,
  PgParserModule,
  ScanToken,
  SupportedVersion,
  WrappedDeparseResult,
  WrappedParseResult,
  WrappedScanResult,
} from './types/index.js';
import { isSupportedVersion } from './util.js';

type Pointer = number;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const KEYWORD_KINDS: KeywordKind[] = [
  'none',
  'unreserved',
  'col_name',
  'type_func_name',
  'reserved',
];

/**
 * Reads a null-terminated UTF-8 string from the WASM heap.
 */
function readString(heap: Int8Array, ptr: number): string {
  let end = ptr;
  while (heap[end] !== 0) end++;
  return textDecoder.decode(new Uint8Array(heap.buffer, ptr, end - ptr));
}

export type PgParserOptions<Version extends SupportedVersion> = {
  version?: Version | number;
};

export class PgParser<Version extends SupportedVersion = 17> {
  readonly ready: Promise<void>;
  readonly version: Version;

  #module: Promise<MainModule<Version>>;

  /**
   * Creates a new PgParser instance with the given options.
   */
  constructor({ version = 17 }: PgParserOptions<Version> = {}) {
    if (!isSupportedVersion(version)) {
      throw new Error(`unsupported version: ${version}`);
    }

    this.#module = this.#init(version);
    this.ready = this.#module.then();
    this.version = version as Version;
  }

  /**
   * Returns the current WASM heap size in bytes.
   * Useful for detecting memory leaks in tests.
   */
  async getHeapSize(): Promise<number> {
    const module = await this.#module;
    return module.HEAP8.length;
  }

  /**
   * Initializes the WASM module.
   */
  async #init(version: SupportedVersion) {
    const createModule = await this.#loadFactory(version);

    // In Node.js (including SSR), tell Emscripten to resolve the WASM file
    // using its script directory instead of `new URL(file, import.meta.url)`.
    // Bundlers like webpack/turbopack rewrite that URL pattern into an asset
    // path (e.g. /_next/static/media/...) that isn't valid on the filesystem.
    // The script directory is correctly derived from import.meta.url by the
    // Emscripten glue code and points to the actual .wasm file location.
    const isNode =
      typeof process !== 'undefined' && !!process.versions?.node;

    return await createModule(
      isNode
        ? {
            locateFile: (path: string, scriptDirectory: string) =>
              scriptDirectory + path,
          }
        : undefined
    );
  }

  /**
   * Loads the WASM module factory for the given version.
   *
   * Note we intentionally don't use template strings on a single import
   * statement to avoid bundling issues that occur during static analysis.
   */
  async #loadFactory(version: SupportedVersion) {
    switch (version) {
      case 15:
        return await import('../wasm/15/pg-parser.js').then<
          PgParserModule<Version>
        >((module) => module.default);
      case 16:
        return await import('../wasm/16/pg-parser.js').then<
          PgParserModule<Version>
        >((module) => module.default);
      case 17:
        return await import('../wasm/17/pg-parser.js').then<
          PgParserModule<Version>
        >((module) => module.default);
      default:
        throw new Error(`unsupported version: ${version}`);
    }
  }

  /**
   * Parses the given SQL string to a Postgres AST.
   */
  async parse(sql: string) {
    const module = await this.#module;

    const sqlBytes = textEncoder.encode(sql);
    const sqlPtr = module._malloc(sqlBytes.length + 1); // +1 for null terminator
    module.HEAP8.set(sqlBytes, sqlPtr);
    module.HEAP8[sqlPtr + sqlBytes.length] = 0; // null terminator

    const resultPtr = module._parse_sql(sqlPtr);
    module._free(sqlPtr);

    try {
      return await this.#parsePgQueryParseResult(resultPtr);
    } finally {
      module._free_parse_result(resultPtr);
    }
  }

  /**
   * Parses a PgQueryParseResult struct from a pointer
   */
  async #parsePgQueryParseResult(
    resultPtr: number
  ): Promise<WrappedParseResult<Version>> {
    const module = await this.#module;

    if (!resultPtr) {
      throw new Error('result pointer is null (protobuf to json failed)');
    }

    const parseTreePtr = module.getValue(resultPtr, 'i32');
    const stderrBufferPtr = module.getValue(resultPtr + 4, 'i32');
    const errorPtr = module.getValue(resultPtr + 8, 'i32');

    const tree = parseTreePtr
      ? JSON.parse(readString(module.HEAP8, parseTreePtr))
      : undefined;

    // TODO: add debug mode + print this to stdout/stderr
    const stderrBuffer = stderrBufferPtr
      ? readString(module.HEAP8, stderrBufferPtr)
      : undefined;

    const error = errorPtr
      ? await this.#parsePgQueryError(errorPtr)
      : undefined;

    if (error) {
      return {
        tree: undefined,
        error,
      };
    }

    if (!parseTreePtr) {
      throw new Error('parse tree is undefined');
    }

    if (!tree) {
      throw new Error('both parse tree and error are undefined');
    }

    return {
      tree,
      error: undefined,
    };
  }

  /**
   * Converts an AST back into a SQL string.
   *
   * Accepts either a full `ParseResult` (as returned by `parse()`) or
   * a single `Node` (e.g. `SelectStmt`, `A_Expr`, `RangeVar`).
   *
   * When a `Node` is passed, only that node is deparsed, producing a
   * SQL fragment rather than a complete statement. This is useful for
   * extracting and deparsing subqueries, expressions, or clauses.
   *
   * @example
   * // Full ParseResult
   * const { tree } = await parser.parse('SELECT 1');
   * const { sql } = await parser.deparse(tree); // 'SELECT 1'
   *
   * @example
   * // Extract and deparse a WHERE clause
   * const { tree } = await parser.parse('SELECT * FROM users WHERE active = true AND age > 18');
   * const { node: select } = unwrapNode(tree.stmts[0].stmt);
   * const { sql } = await parser.deparse(select.whereClause); // 'active = true AND age > 18'
   *
   * @example
   * // Drill deeper: extract each condition from the AND expression
   * const { node: bool } = unwrapNode(select.whereClause);
   * const { sql: left } = await parser.deparse(bool.args[0]); // 'active = true'
   * const { sql: right } = await parser.deparse(bool.args[1]); // 'age > 18'
   */
  async deparse(
    input: ParseResult<Version> | Node<Version>
  ): Promise<WrappedDeparseResult> {
    const module = await this.#module;

    // Node wrappers always have a single PascalCase key (e.g. 'SelectStmt'),
    // never 'stmts' or 'version', so this safely distinguishes the two.
    const isParseResult = 'stmts' in input || 'version' in input;
    const json = JSON.stringify(input);

    const jsonBytes = textEncoder.encode(json);
    const jsonPtr = module._malloc(jsonBytes.length + 1); // +1 for null terminator
    module.HEAP8.set(jsonBytes, jsonPtr);
    module.HEAP8[jsonPtr + jsonBytes.length] = 0; // null terminator

    const deparseResultPtr: Pointer = isParseResult
      ? module._deparse_sql(jsonPtr)
      : module._deparse_node(jsonPtr);
    module._free(jsonPtr);

    if (!deparseResultPtr) {
      throw new Error('deparse failed: null result pointer');
    }

    try {
      // Parse struct PgQueryDeparseResult from the pointer
      const queryPtr = module.getValue(deparseResultPtr, 'i32');
      const errorPtr = module.getValue(deparseResultPtr + 4, 'i32');
      const error = errorPtr
        ? await this.#parseDeparseError(errorPtr)
        : undefined;

      if (error) {
        return {
          sql: undefined,
          error,
        };
      }

      const sql = queryPtr ? readString(module.HEAP8, queryPtr) : undefined;

      if (!sql) {
        throw new Error('query is undefined');
      }

      return {
        sql,
        error: undefined,
      };
    } finally {
      module._free_deparse_result(deparseResultPtr);
    }
  }

  /**
   * Reads the common fields from a PgQueryError struct pointer.
   *
   * The struct layout (WASM32) is:
   * ```c
   * typedef struct {
   *   char *message;     // offset 0
   *   char *funcname;    // offset 4
   *   char *filename;    // offset 8
   *   int lineno;        // offset 12
   *   int cursorpos;     // offset 16
   *   char *context;     // offset 20
   * } PgQueryError;
   * ```
   */
  async #readPgQueryError(errorPtr: number) {
    const module = await this.#module;

    const messagePtr = module.getValue(errorPtr, 'i32');
    const fileNamePtr = module.getValue(errorPtr + 8, 'i32');
    const cursorpos = module.getValue(errorPtr + 16, 'i32');

    const message = messagePtr
      ? readString(module.HEAP8, messagePtr)
      : 'unknown error';
    const fileName = fileNamePtr
      ? readString(module.HEAP8, fileNamePtr)
      : undefined;
    const position = cursorpos > 0 ? cursorpos - 1 : 0; // Convert 1-based to 0-based

    return { message, fileName, position };
  }

  async #parsePgQueryError(errorPtr: number) {
    const { message, fileName, position } =
      await this.#readPgQueryError(errorPtr);
    const type: ParseErrorType = fileName
      ? getParseErrorType(fileName)
      : 'unknown';
    return new ParseError(message, { type, position });
  }

  /**
   * Reads a PgQueryError struct from a pointer and returns a DeparseError.
   * Only reads the message field since deparse errors don't have
   * meaningful position or type information.
   */
  async #parseDeparseError(errorPtr: number) {
    const { message } = await this.#readPgQueryError(errorPtr);
    return new DeparseError(message);
  }

  /**
   * Scans (lexes) the given SQL string into an array of tokens.
   *
   * Each token includes its kind (raw PG token name), the original text,
   * byte offsets, and keyword classification.
   */
  async scan(sql: string): Promise<WrappedScanResult> {
    const module = await this.#module;

    const sqlBytes = textEncoder.encode(sql);
    const sqlPtr = module._malloc(sqlBytes.length + 1);
    module.HEAP8.set(sqlBytes, sqlPtr);
    module.HEAP8[sqlPtr + sqlBytes.length] = 0;

    const resultPtr = module._scan_sql(sqlPtr);
    module._free(sqlPtr);

    if (!resultPtr) {
      throw new Error('scan failed: null result pointer');
    }

    try {
      // PgScanResult struct: n_tokens(4) + tokens_ptr(4) + error_ptr(4)
      const nTokens = module.getValue(resultPtr, 'i32');
      const tokensPtr = module.getValue(resultPtr + 4, 'i32');
      const errorPtr = module.getValue(resultPtr + 8, 'i32');

      if (errorPtr) {
        const error = await this.#parseScanError(errorPtr);
        return { tokens: undefined, error };
      }

      const tokens: ScanToken[] = [];
      for (let i = 0; i < nTokens; i++) {
        // ScanTokenData: start(4) + end(4) + name_ptr(4) + keyword_kind(4) = 16 bytes
        const base = tokensPtr + i * 16;
        const start = module.getValue(base, 'i32');
        const end = module.getValue(base + 4, 'i32');
        const namePtr = module.getValue(base + 8, 'i32');
        const kwKind = module.getValue(base + 12, 'i32');

        tokens.push({
          kind: readString(module.HEAP8, namePtr),
          text: textDecoder.decode(sqlBytes.slice(start, end)),
          start,
          end,
          keywordKind: KEYWORD_KINDS[kwKind] ?? 'none',
        });
      }

      return { tokens, error: undefined };
    } finally {
      module._free_scan_result(resultPtr);
    }
  }

  async #parseScanError(errorPtr: number) {
    const { message, fileName, position } =
      await this.#readPgQueryError(errorPtr);
    const type: ScanErrorType = fileName
      ? (getParseErrorType(fileName) === 'syntax' ? 'syntax' : 'unknown')
      : 'unknown';
    return new ScanError(message, { type, position });
  }
}
