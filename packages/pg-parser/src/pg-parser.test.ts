import { describe, expect, it } from 'vitest';
import { PgParser } from './pg-parser.js';
import { unwrapResult } from './util.js';

describe('pg-parser', () => {
  it('parses sql in v15', async () => {
    const pgParser = new PgParser({ version: 15 });
    const result = await unwrapResult(pgParser.parseSql('SELECT 1+1 as sum'));
    expect(result.version).toBe(150001);
  });

  it('parses sql in v16', async () => {
    const pgParser = new PgParser({ version: 16 });
    const result = await unwrapResult(pgParser.parseSql('SELECT 1+1 as sum'));
    expect(result.version).toBe(160001);
  });

  it('parses sql in v17', async () => {
    const pgParser = new PgParser({ version: 17 });
    const result = await unwrapResult(pgParser.parseSql('SELECT 1+1 as sum'));
    expect(result.version).toBe(170004);
  });

  it('throws error for invalid sql', async () => {
    const pgParser = new PgParser();
    const resultPromise = unwrapResult(pgParser.parseSql('my invalid sql'));
    await expect(resultPromise).rejects.toThrow('syntax error at or near "my"');
  });

  it('throws error for unsupported version', async () => {
    const create = () => new PgParser({ version: 13 as any });
    expect(create).toThrow('unsupported version');
  });
});
