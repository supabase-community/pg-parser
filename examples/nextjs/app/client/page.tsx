'use client';

import { PgParser, unwrapParseResult } from '@supabase/pg-parser';
import { useEffect, useState } from 'react';

export default function ClientPage() {
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function run() {
      const parser = new PgParser();

      const tree = await unwrapParseResult(parser.parse('SELECT 1 + 2 AS sum'));
      setResult(JSON.stringify(tree, null, 2));
    }

    run().catch((err) => setError(String(err)));
  }, []);

  return (
    <div>
      <h1>pg-parser Next.js Client Test</h1>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      {result ? <pre>{result}</pre> : <p>Loading...</p>}
    </div>
  );
}
