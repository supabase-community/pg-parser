export type ParseErrorType = 'syntax' | 'semantic' | 'unknown';

export type ParseErrorDetails = {
  type: ParseErrorType;
  position: number;
};

export class ParseError extends Error {
  override readonly name = 'ParseError';

  /**
   * The type of parse error. Possible values are:
   *
   * - `syntax`: A lexical or syntactic error, such as mismatched parentheses,
   *   unterminated quotes, invalid tokens, or incorrect SQL statement structure.
   *   Most SQL errors will fall into this category.
   *
   * - `semantic`: These are rare, but can occur during specific validations like
   *   numeric range checking (e.g., column numbers must be between 1 and 32767
   *   in ALTER INDEX statements).
   *
   * - `unknown`: An unknown error type, typically representing an internal parser error.
   *
   * Note: The vast majority of semantic validation (type checking, schema validation,
   * constraint validation, etc.) happens after parsing and is not represented in these error types.
   */
  type: ParseErrorType;

  /**
   * The position of the error in the SQL string.
   * This is a zero-based index, so the first character is at position 0.
   * Points to the character where the error was detected.
   */
  position: number;

  constructor(message: string, { type, position }: ParseErrorDetails) {
    super(message);
    this.type = type;
    this.position = position;
  }
}

/**
 * An error that occurred while deparsing an AST back to SQL.
 *
 * Unlike `ParseError`, deparse errors don't have a position or type
 * since they operate on an AST rather than a SQL string.
 */
export class DeparseError extends Error {
  override readonly name = 'DeparseError';
}

export type ScanErrorType = 'syntax' | 'unknown';

export type ScanErrorDetails = {
  type: ScanErrorType;
  position: number;
};

/**
 * An error that occurred while scanning/lexing a SQL string.
 *
 * Scan errors are always lexical in nature (e.g. unterminated string
 * literals, invalid escape sequences).
 */
export class ScanError extends Error {
  override readonly name = 'ScanError';

  /**
   * The type of scan error. Will be `syntax` for lexical errors
   * from the scanner, or `unknown` for unexpected internal errors.
   */
  type: ScanErrorType;

  /**
   * The position of the error in the SQL string.
   * This is a zero-based index, so the first character is at position 0.
   */
  position: number;

  constructor(message: string, { type, position }: ScanErrorDetails) {
    super(message);
    this.type = type;
    this.position = position;
  }
}

/**
 * Get the type of parse error based on the internal file name
 * returned from libpg_query.
 */
export function getParseErrorType(fileName: string): ParseErrorType {
  switch (fileName) {
    case 'scan.l':
      return 'syntax';
    case 'gram.y':
      return 'semantic';
    default:
      return 'unknown';
  }
}
