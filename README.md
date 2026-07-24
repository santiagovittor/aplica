# Aplica

Paste a job posting, get a resume and cover letter tailored to it, in your real
voice, that does not sound like AI. Bilingual (English / Spanish), MIT licensed,
and bring-your-own-key: the app never ships a model API key of its own.

Full scope lives in [PROJECT.md](./PROJECT.md). The design system is
[DESIGN.md](./DESIGN.md). Engineering rules are [CLAUDE.md](./CLAUDE.md).

## Status

Step 1 of the build: the app shell. Next.js App Router, TypeScript, next-intl
with English and Spanish, the two display fonts, and reduced-motion support.
No product features yet.

## Run it yourself

Requires Node 20 or newer.

```bash
npm install
npm run dev
```

Then open http://localhost:3000. You land on `/en` or `/es` depending on your
browser language.

```bash
npm run typecheck   # tsc, no emit
npm run lint        # eslint
npm run format      # prettier
npm run build       # production build
```

## Your API key

Aplica calls your model provider (Anthropic, OpenAI or Google) with a key you
supply. When self-hosting, that key stays in your own database: encrypted at
rest with AES-256-GCM, used server-side only, never sent back to the browser and
never logged. You can delete it in one click. The details are in PROJECT.md
section 6.

Key storage arrives with the Supabase step; this scaffold stores nothing yet.

## License

MIT. See [LICENSE](./LICENSE).
