import {
  getParseErrorType,
  ParseError,
  type ParseErrorType,
} from './errors.js';
import type {
  MainModule,
  PgParserModule,
  SupportedVersion,
  WrappedParseResult,
} from './types/index.js';
import { isSupportedVersion } from './util.js';

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

    const resultPtr = module.ccall('parse_sql', 'number', ['string'], [sql]);
    const parseResult = await this.#parsePgQueryParseResult(resultPtr);
    module.ccall('free_parse_result', undefined, ['number'], [resultPtr]);

    return parseResult;
  }

  /**
   * Parses a PgQueryParseResult struct from a pointer
   */
  async #parsePgQueryParseResult(
    resultPtr: number
  ): Promise<WrappedParseResult<Version>> {
    const module = await this.#module;

    const parseTreePtr = module.getValue(resultPtr, 'i32');
    const stderrBufferPtr = module.getValue(resultPtr + 4, 'i32');
    const errorPtr = module.getValue(resultPtr + 8, 'i32');

    const tree = parseTreePtr
      ? JSON.parse(module.UTF8ToString(parseTreePtr))
      : undefined;

    // TODO: add debug mode + print this to stdout/stderr
    const stderrBuffer = stderrBufferPtr
      ? module.UTF8ToString(stderrBufferPtr)
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

    if (!tree) {
      throw new Error('both parse tree and error are undefined');
    }

    return {
      tree,
      error: undefined,
    };
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
    const position = module.getValue(errorPtr + 16, 'i32') - 1; // Convert to zero-based index

    const message = messagePtr
      ? module.UTF8ToString(messagePtr)
      : 'unknown error';
    const type: ParseErrorType = fileNamePtr
      ? getParseErrorType(module.UTF8ToString(fileNamePtr))
      : 'unknown';

    const error = new ParseError(message, {
      type,
      position,
    });

    return error;
  }
}
