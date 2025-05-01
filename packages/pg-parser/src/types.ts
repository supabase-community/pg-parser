import { type MainModule as MainModule15 } from '../wasm/15/pg-parser.js';
import { type MainModule as MainModule16 } from '../wasm/16/pg-parser.js';
import { type MainModule as MainModule17 } from '../wasm/17/pg-parser.js';

import type { ParseResult as ParseResult15 } from '../wasm/15/pg-parser-types.js';
import type { ParseResult as ParseResult16 } from '../wasm/16/pg-parser-types.js';
import type { ParseResult as ParseResult17 } from '../wasm/17/pg-parser-types.js';

import type { PgParseError } from './errors.js';
import type { SUPPORTED_VERSIONS } from './constants.js';

export type SupportedVersion = (typeof SUPPORTED_VERSIONS)[number];

type ModuleVersionMap = {
  15: MainModule15;
  16: MainModule16;
  17: MainModule17;
};

type ParseResultVersionMap = {
  15: ParseResult15;
  16: ParseResult16;
  17: ParseResult17;
};

export type MainModule<T extends SupportedVersion> = ModuleVersionMap[T];
export type PgParserModule<T extends SupportedVersion> = (
  options?: unknown
) => Promise<MainModule<T>>;
export type ParseResult<T extends SupportedVersion> = ParseResultVersionMap[T];

export type PgParseResultSuccess<T extends SupportedVersion> = {
  tree: ParseResult<T>;
  error: undefined;
  stderrBuffer?: string;
};

export type PgParseResultError = {
  tree: undefined;
  error: PgParseError;
};

export type PgParseResult<T extends SupportedVersion> =
  | PgParseResultSuccess<T>
  | PgParseResultError;
