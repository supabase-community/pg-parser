/// <reference path="../test/types/sql.d.ts" />

import { describe, expect, it } from 'vitest';
import { PgParser } from './pg-parser.js';
import { unwrapScanResult } from './util.js';

import sqlDump from '../test/fixtures/dump.sql';

describe.each([15, 16, 17])('scanner (v%i)', (version) => {
  const pgParser = new PgParser({ version }) as PgParser;

  it('scans SQL into tokens', async () => {
    const tokens = await unwrapScanResult(pgParser.scan('SELECT 1'));

    expect(tokens).toEqual([
      {
        kind: 'SELECT',
        text: 'SELECT',
        start: 0,
        end: 6,
        keywordKind: 'reserved',
      },
      {
        kind: 'ICONST',
        text: '1',
        start: 7,
        end: 8,
        keywordKind: 'none',
      },
    ]);
  });

  it('scans identifiers and operators', async () => {
    const tokens = await unwrapScanResult(pgParser.scan('SELECT a + b FROM t'));

    expect(tokens).toMatchObject([
      { kind: 'SELECT', text: 'SELECT' },
      { kind: 'IDENT', text: 'a' },
      { kind: 'ASCII_43', text: '+' },
      { kind: 'IDENT', text: 'b' },
      { kind: 'FROM', text: 'FROM' },
      { kind: 'IDENT', text: 't' },
    ]);
  });

  it('scans multi-char operators', async () => {
    const tokens = await unwrapScanResult(
      pgParser.scan('SELECT 1::text, a <= b, c <> d, e != f'),
    );

    const ops = tokens.filter((t) =>
      ['TYPECAST', 'LESS_EQUALS', 'NOT_EQUALS'].includes(t.kind),
    );

    expect(ops).toMatchObject([
      { kind: 'TYPECAST', text: '::' },
      { kind: 'LESS_EQUALS', text: '<=' },
      { kind: 'NOT_EQUALS', text: '<>' },
      { kind: 'NOT_EQUALS', text: '!=' },
    ]);
  });

  it('scans string constants', async () => {
    const tokens = await unwrapScanResult(
      pgParser.scan("SELECT 'hello world'"),
    );

    expect(tokens).toMatchObject([
      { kind: 'SELECT', text: 'SELECT' },
      { kind: 'SCONST', text: "'hello world'" },
    ]);
  });

  it('scans quoted identifiers', async () => {
    const tokens = await unwrapScanResult(
      pgParser.scan('SELECT "MyColumn" FROM "MyTable"'),
    );

    const idents = tokens.filter((t) => t.kind === 'IDENT');
    expect(idents).toMatchObject([
      { text: '"MyColumn"' },
      { text: '"MyTable"' },
    ]);
  });

  it('scans parentheses and punctuation', async () => {
    const tokens = await unwrapScanResult(pgParser.scan('SELECT (1, 2)'));

    expect(tokens).toMatchObject([
      { kind: 'SELECT', text: 'SELECT' },
      { kind: 'ASCII_40', text: '(' },
      { kind: 'ICONST', text: '1' },
      { kind: 'ASCII_44', text: ',' },
      { kind: 'ICONST', text: '2' },
      { kind: 'ASCII_41', text: ')' },
    ]);
  });

  it('classifies keyword kinds', async () => {
    const tokens = await unwrapScanResult(
      pgParser.scan('SELECT name FROM users WHERE id = 1'),
    );

    const select = tokens.find((t) => t.kind === 'SELECT');
    expect(select?.keywordKind).toBe('reserved');

    const from = tokens.find((t) => t.kind === 'FROM');
    expect(from?.keywordKind).toBe('reserved');

    const where = tokens.find((t) => t.kind === 'WHERE');
    expect(where?.keywordKind).toBe('reserved');

    // Non-keyword tokens should be 'none'
    const idents = tokens.filter((t) => t.kind === 'IDENT');
    for (const ident of idents) {
      expect(ident.keywordKind).toBe('none');
    }
  });

  it('handles multi-byte UTF-8 characters', async () => {
    const tokens = await unwrapScanResult(pgParser.scan("SELECT 'café'"));

    expect(tokens).toMatchObject([
      { kind: 'SELECT', text: 'SELECT' },
      { kind: 'SCONST', text: "'café'" },
    ]);
  });

  it('reports correct byte offsets for multi-byte UTF-8', async () => {
    // 'café' = 6 bytes UTF-8: c(1) a(1) f(1) é(2) + quotes(2) = 8 bytes
    const tokens = await unwrapScanResult(pgParser.scan("SELECT 'café'"));
    const sconst = tokens.find((t) => t.kind === 'SCONST')!;

    // SELECT(6) + space(1) = offset 7
    expect(sconst.start).toBe(7);
    // 'café' = quote(1) + c(1) + a(1) + f(1) + é(2) + quote(1) = 7 bytes
    expect(sconst.end).toBe(14);
    expect(sconst.text).toBe("'café'");
  });

  it('handles emoji in strings', async () => {
    const tokens = await unwrapScanResult(pgParser.scan("SELECT '🚀'"));

    expect(tokens).toMatchObject([
      { kind: 'SELECT', text: 'SELECT' },
      { kind: 'SCONST', text: "'🚀'" },
    ]);
  });

  it('handles CJK characters', async () => {
    const tokens = await unwrapScanResult(
      pgParser.scan("SELECT '日本語テスト'"),
    );

    expect(tokens).toMatchObject([
      { kind: 'SELECT', text: 'SELECT' },
      { kind: 'SCONST', text: "'日本語テスト'" },
    ]);
  });

  it('scans comments as tokens', async () => {
    const tokens = await unwrapScanResult(
      pgParser.scan('SELECT /* a comment */ 1'),
    );

    const comment = tokens.find((t) => t.kind === 'C_COMMENT');
    expect(comment).toMatchObject({
      kind: 'C_COMMENT',
      text: '/* a comment */',
    });
  });

  it('scans line comments', async () => {
    const tokens = await unwrapScanResult(
      pgParser.scan('SELECT 1 -- a comment'),
    );

    const comment = tokens.find((t) => t.kind === 'SQL_COMMENT');
    expect(comment).toMatchObject({
      kind: 'SQL_COMMENT',
      text: '-- a comment',
    });
  });

  it('returns empty array for empty input', async () => {
    const tokens = await unwrapScanResult(pgParser.scan(''));
    expect(tokens).toEqual([]);
  });

  it('returns empty array for whitespace-only input', async () => {
    const tokens = await unwrapScanResult(pgParser.scan('   \t\n  '));
    expect(tokens).toEqual([]);
  });

  it('scans dollar-quoted strings', async () => {
    const tokens = await unwrapScanResult(
      pgParser.scan("SELECT $$hello world$$"),
    );

    expect(tokens).toMatchObject([
      { kind: 'SELECT', text: 'SELECT' },
      { kind: 'SCONST', text: '$$hello world$$' },
    ]);
  });

  it('scans tagged dollar-quoted strings', async () => {
    const tokens = await unwrapScanResult(
      pgParser.scan("SELECT $body$hello world$body$"),
    );

    expect(tokens).toMatchObject([
      { kind: 'SELECT', text: 'SELECT' },
      { kind: 'SCONST', text: '$body$hello world$body$' },
    ]);
  });

  it('returns ScanError for unterminated string', async () => {
    const result = await pgParser.scan("SELECT 'unterminated");

    expect(result.error).toBeDefined();
    expect(result.error!.name).toBe('ScanError');
    expect(result.error!.type).toBe('syntax');
    expect(result.error!.message).toBeTruthy();
    expect(result.tokens).toBeUndefined();
  });

  it('reports error position for unterminated string', async () => {
    const sql = "SELECT 'unterminated";
    const result = await pgParser.scan(sql);

    expect(result.error).toBeDefined();
    expect(result.error!.position).toBe(sql.indexOf("'"));
  });

  it('throws via unwrapScanResult for invalid input', async () => {
    await expect(
      unwrapScanResult(pgParser.scan("SELECT 'unterminated")),
    ).rejects.toThrow();
  });

  it('preserves byte offsets across tokens', async () => {
    const sql = 'SELECT id, name FROM users';
    const tokens = await unwrapScanResult(pgParser.scan(sql));

    // Verify each token's text matches the slice from the original SQL
    const encoder = new TextEncoder();
    const sqlBytes = encoder.encode(sql);
    const decoder = new TextDecoder();

    for (const token of tokens) {
      const sliced = decoder.decode(sqlBytes.slice(token.start, token.end));
      expect(sliced).toBe(token.text);
    }
  });

  it('scans large SQL', async () => {
    const tokens = await unwrapScanResult(pgParser.scan(sqlDump));
    expect(tokens.length).toBeGreaterThan(0);

    // Verify every token has valid text from the original SQL
    const encoder = new TextEncoder();
    const sqlBytes = encoder.encode(sqlDump);
    const decoder = new TextDecoder();

    for (const token of tokens) {
      const sliced = decoder.decode(sqlBytes.slice(token.start, token.end));
      expect(sliced).toBe(token.text);
    }
  });

  it('does not leak memory during repeated scan operations', async () => {
    // Warm up
    await unwrapScanResult(pgParser.scan('SELECT 1'));

    const heapBefore = await pgParser.getHeapSize();

    for (let i = 0; i < 1000; i++) {
      await unwrapScanResult(pgParser.scan('SELECT 1'));
    }

    const heapAfter = await pgParser.getHeapSize();

    // Allow up to 1 WASM page (64 KB) of growth for internal allocator overhead
    expect(heapAfter - heapBefore).toBeLessThan(64 * 1024);
  });
});
