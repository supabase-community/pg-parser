export class PgParseError extends Error {
  override readonly name = 'PgQueryError';

  funcname?: string;
  filename?: string;
  lineno: number;
  cursorpos: number;
  context?: string;

  constructor({
    message,
    funcname,
    filename,
    lineno,
    cursorpos,
    context,
  }: {
    message?: string;
    funcname?: string;
    filename?: string;
    lineno: number;
    cursorpos: number;
    context?: string;
  }) {
    super(message);

    this.funcname = funcname;
    this.filename = filename;
    this.lineno = lineno;
    this.cursorpos = cursorpos;
    this.context = context;
  }
}
