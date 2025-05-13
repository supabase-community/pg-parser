import type { MainModule as MainModule15 } from '../../wasm/15/pg-parser.js';
import type { MainModule as MainModule16 } from '../../wasm/16/pg-parser.js';
import type { MainModule as MainModule17 } from '../../wasm/17/pg-parser.js';

import type { Node15, ParseResult15 } from './15.js';
import type { Node16, ParseResult16 } from './16.js';
import type { Node17, ParseResult17 } from './17.js';

import type { SUPPORTED_VERSIONS } from '../constants.js';
import type { ParseError } from '../errors.js';

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

type NodeVersionMap = {
  15: Node15;
  16: Node16;
  17: Node17;
};

export type MainModule<Version extends SupportedVersion> =
  ModuleVersionMap[Version];
export type PgParserModule<T extends SupportedVersion> = (
  options?: unknown
) => Promise<MainModule<T>>;

export type ParseResult<T extends SupportedVersion = SupportedVersion> =
  ParseResultVersionMap[T];

export type Node<Version extends SupportedVersion = SupportedVersion> =
  NodeVersionMap[Version];

export type WrappedParseSuccess<Version extends SupportedVersion> = {
  tree: ParseResult<Version>;
  error: undefined;
};

export type WrappedParseError = {
  tree: undefined;
  error: ParseError;
};

export type WrappedParseResult<Version extends SupportedVersion> =
  | WrappedParseSuccess<Version>
  | WrappedParseError;

export type WrappedDeparseSuccess = {
  sql: string;
  error: undefined;
};

export type WrappedDeparseError = {
  sql: undefined;
  error: ParseError;
};

export type WrappedDeparseResult = WrappedDeparseSuccess | WrappedDeparseError;
