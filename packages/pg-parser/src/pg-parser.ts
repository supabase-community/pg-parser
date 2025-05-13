import { SUPPORTED_VERSIONS } from './constants.js';
import { PgParseError } from './errors.js';
import type {
  MainModule,
  ParseResult,
  PgDeparseResult,
  PgParseResult,
  PgParserModule,
  SupportedVersion,
} from './types.js';

type Pointer = number;

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

  async parse(sql: string): Promise<PgParseResult<T>> {
    const module = await this.#module;

    const parseResultPtr: Pointer = module.ccall(
      'parse_sql',
      'number',
      ['string'],
      [sql]
    );

    // Parse struct PgQueryProtobufParseResult from the pointer
    const parseTreePtr = parseResultPtr;
    const stderrBufferPtr: Pointer = module.getValue(parseResultPtr + 8, 'i32');
    const errorPtr: Pointer = module.getValue(parseResultPtr + 12, 'i32');
    const error = errorPtr
      ? await this.#parsePgQueryError(errorPtr)
      : undefined;

    if (error) {
      module.ccall(
        'free_parse_result',
        undefined,
        ['number'],
        [parseResultPtr]
      );
      return {
        tree: undefined,
        error,
      };
    }

    if (!parseTreePtr) {
      throw new Error('parse tree is undefined');
    }

    const stderrBuffer = stderrBufferPtr
      ? module.UTF8ToString(stderrBufferPtr)
      : undefined;

    // Convert protobuf to JSON
    const protobufToJsonResultPtr: Pointer = module.ccall(
      'protobuf_to_json',
      'number',
      ['number'],
      [parseTreePtr]
    );

    const parseResult = await this.#parseProtobufToJsonResult<T>(
      protobufToJsonResultPtr
    );

    module.ccall('free_parse_result', undefined, ['number'], [parseResultPtr]);

    return {
      tree: parseResult,
      error: undefined,
      stderrBuffer,
    };
  }

  async deparse(parseTree: ParseResult<T>): Promise<PgDeparseResult> {
    const module = await this.#module;

    // Convert JSON to protobuf
    const jsonToProtobufResultPtr: Pointer = module.ccall(
      'json_to_protobuf',
      'number',
      ['string'],
      [JSON.stringify(parseTree)]
    );

    const protobufPtr = await this.#parseJsonToProtobufResult(
      jsonToProtobufResultPtr
    );

    const deparseResultPtr: Pointer = module.ccall(
      'deparse_sql',
      'number',
      ['number'],
      [protobufPtr]
    );

    // Free the protobuf result after we're done with it
    module.ccall(
      'free_json_to_protobuf_result',
      undefined,
      ['number'],
      [jsonToProtobufResultPtr]
    );

    // Parse struct PgQueryDeparseResult from the pointer
    const queryPtr = module.getValue(deparseResultPtr, 'i32');
    const errorPtr = module.getValue(deparseResultPtr + 4, 'i32');
    const error = errorPtr
      ? await this.#parsePgQueryError(errorPtr)
      : undefined;

    if (error) {
      module.ccall(
        'free_deparse_result',
        undefined,
        ['number'],
        [deparseResultPtr]
      );
      return {
        sql: undefined,
        error,
      };
    }

    const sql = queryPtr ? module.UTF8ToString(queryPtr) : undefined;

    if (!sql) {
      module.ccall(
        'free_deparse_result',
        undefined,
        ['number'],
        [deparseResultPtr]
      );
      throw new Error('query is undefined');
    }

    module.ccall(
      'free_deparse_result',
      undefined,
      ['number'],
      [deparseResultPtr]
    );

    return {
      sql,
      error: undefined,
    };
  }

  /**
   * Parses a ProtobufToJsonResult struct from a pointer.
   */
  async #parseProtobufToJsonResult<T>(resultPtr: Pointer): Promise<T> {
    const module = await this.#module;

    const jsonStringPtr = module.getValue(resultPtr, 'i32');
    const errorPtr = module.getValue(resultPtr + 4, 'i32');

    const jsonString = jsonStringPtr
      ? module.UTF8ToString(jsonStringPtr)
      : undefined;
    const error = errorPtr ? module.UTF8ToString(errorPtr) : undefined;

    module.ccall(
      'free_protobuf_to_json_result',
      undefined,
      ['number'],
      [resultPtr]
    );

    if (error) {
      // This is unexpected, so throw instead of returning an error
      throw new Error(error);
    }

    if (!jsonString) {
      throw new Error('both json string and error are undefined');
    }

    return JSON.parse(jsonString);
  }

  async #parseJsonToProtobufResult(resultPtr: Pointer): Promise<Pointer> {
    const module = await this.#module;

    const pgQueryProtobufPtr = resultPtr;
    const errorPtr: number = module.getValue(resultPtr + 8, 'i32');

    const error = errorPtr ? module.UTF8ToString(errorPtr) : undefined;

    if (error) {
      // This is unexpected, so throw instead of returning an error
      throw new Error(error);
    }

    return pgQueryProtobufPtr;
  }

  /**
   * Parses a PgQueryError struct from a pointer.
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
