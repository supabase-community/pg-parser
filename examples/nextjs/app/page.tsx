import { PgParser, unwrapParseResult } from '@supabase/pg-parser';

export default async function Home() {
  const parser = new PgParser();

  const tree = await unwrapParseResult(parser.parse('SELECT 1'));

  return (
    <div>
      <h1>pg-parser Next.js SSR Test</h1>
      <pre>{JSON.stringify(tree, null, 2)}</pre>
    </div>
  );
}
