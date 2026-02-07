# Next.js Example

Smoke test for `@supabase/pg-parser` in a Next.js app with Turbopack. Covers both Server Components (SSR) and Client Components.

## Routes

- `/` — Server Component that parses SQL during SSR
- `/client` — Client Component that parses SQL in the browser

## Usage

```bash
pnpm dev
```

## CI

This example is built in CI via `pnpm --filter nextjs build`. The `next build` step compiles with Turbopack (catches bundler issues) and prerenders all pages (catches SSR runtime errors).
