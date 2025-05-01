import { SUPPORTED_VERSIONS } from './constants.js';
import { PgParseError } from './errors.js';
import type {
  MainModule,
  PgParseResult,
  PgParserModule,
  SupportedVersion,
} from './types.js';

export type PgParserOptions<T extends SupportedVersion> = {
  version?: T;
};

export class PgParser<T extends SupportedVersion = 17> {
  readonly ready: Promise<void>;
  readonly version: T;

  #module: Promise<MainModule<T>>;

  constructor({ version = 17 as T }: PgParserOptions<T> = {}) {
    if (!SUPPORTED_VERSIONS.includes(version)) {
      throw new Error(`unsupported version: ${version}`);
    }

    this.#module = this.#init(version);
    this.ready = this.#module.then();
    this.version = version;
  }

  async #init(version: SupportedVersion) {
    const createModule = await import(
      `../wasm/${version}/pg-parser.js` as const
    ).then<PgParserModule<T>>((module) => module.default);

    return await createModule();
  }

  async parseSql(sql: string) {
    const module = await this.#module;

    const resultPtr = module.ccall('parse_sql', 'number', ['string'], [sql]);
    const parseResult = await this.#parsePgQueryParseResult(resultPtr);
    module.ccall('free_parse_result', undefined, ['number'], [resultPtr]);

    return parseResult;
  }

  /**
   * Parses a PgQueryParseResult struct from a pointer
   */
  async #parsePgQueryParseResult(resultPtr: number): Promise<PgParseResult<T>> {
    const module = await this.#module;

    const parseTreePtr = module.getValue(resultPtr, 'i32');
    const stderrBufferPtr = module.getValue(resultPtr + 4, 'i32');
    const errorPtr = module.getValue(resultPtr + 8, 'i32');

    const tree = parseTreePtr
      ? JSON.parse(module.UTF8ToString(parseTreePtr))
      : undefined;
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
      stderrBuffer,
    };
  }

  /**
   * Parses a PgQueryError struct from a pointer
   */
  async #parsePgQueryError(errorPtr: number) {
    const module = await this.#module;

    const messagePtr = module.getValue(errorPtr, 'i32');
    const funcnamePtr = module.getValue(errorPtr + 4, 'i32');
    const filenamePtr = module.getValue(errorPtr + 8, 'i32');
    const lineno = module.getValue(errorPtr + 12, 'i32');
    const cursorpos = module.getValue(errorPtr + 16, 'i32');
    const contextPtr = module.getValue(errorPtr + 20, 'i32');

    const error = new PgParseError({
      message: messagePtr ? module.UTF8ToString(messagePtr) : undefined,
      funcname: funcnamePtr ? module.UTF8ToString(funcnamePtr) : undefined,
      filename: filenamePtr ? module.UTF8ToString(filenamePtr) : undefined,
      lineno,
      cursorpos,
      context: contextPtr ? module.UTF8ToString(contextPtr) : undefined,
    });

    return error;
  }
}
