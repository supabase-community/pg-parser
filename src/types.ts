import type { PgParseError } from './errors.js';

export type PgParseResultSuccess = {
  tree: any;
  error: undefined;
  stderrBuffer?: string;
};

export type PgParseResultError = {
  tree: undefined;
  error: PgParseError;
};

export type PgParseResult = PgParseResultSuccess | PgParseResultError;
