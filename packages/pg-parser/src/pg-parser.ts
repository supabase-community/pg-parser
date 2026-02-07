import {
  DeparseError,
  getParseErrorType,
  ParseError,
  type ParseErrorType,
} from './errors.js';
import type {
  MainModule,
  ParseResult,
  PgParserModule,
  SupportedVersion,
  WrappedDeparseResult,
  WrappedParseResult,
} from './types/index.js';
import { isSupportedVersion } from './util.js';

type Pointer = number;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

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
    return await createModule();
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

  async deparse(
    parseResult: ParseResult<Version>
  ): Promise<WrappedDeparseResult> {
    const module = await this.#module;

    const json = JSON.stringify(parseResult);

    const jsonBytes = textEncoder.encode(json);
    const jsonPtr = module._malloc(jsonBytes.length + 1); // +1 for null terminator
    module.HEAP8.set(jsonBytes, jsonPtr);
    module.HEAP8[jsonPtr + jsonBytes.length] = 0; // null terminator

    const deparseResultPtr: Pointer = module._deparse_sql(jsonPtr);
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
   * Parses a PgQueryError struct from a pointer.
   *
   * The struct fields are defined in the C code as:
   * ```c
   * typedef struct {
   *   char *message;
   *   char *funcname;
   *   char *filename;
   *   int lineno;
   *   int cursorpos;
   *   char *context;
   * } PgQueryError;
   * ```
   *
   * We only care about the message and cursorpos fields, along with
   * filename to determine the error type (syntax vs semantic).
   */
  async #parsePgQueryError(errorPtr: number) {
    const module = await this.#module;

    const messagePtr = module.getValue(errorPtr, 'i32');
    const fileNamePtr = module.getValue(errorPtr + 8, 'i32');
    const cursorpos = module.getValue(errorPtr + 16, 'i32');
    const position = cursorpos > 0 ? cursorpos - 1 : 0; // Convert 1-based to 0-based

    const message = messagePtr
      ? readString(module.HEAP8, messagePtr)
      : 'unknown error';
    const type: ParseErrorType = fileNamePtr
      ? getParseErrorType(readString(module.HEAP8, fileNamePtr))
      : 'unknown';

    return new ParseError(message, { type, position });
  }

  /**
   * Reads a PgQueryError struct from a pointer and returns a DeparseError.
   * Only reads the message field since deparse errors don't have
   * meaningful position or type information.
   */
  async #parseDeparseError(errorPtr: number) {
    const module = await this.#module;

    const messagePtr = module.getValue(errorPtr, 'i32');
    const message = messagePtr
      ? readString(module.HEAP8, messagePtr)
      : 'unknown error';

    return new DeparseError(message);
  }
}
