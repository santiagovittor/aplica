# Aplica

Paste a job posting, get a resume and cover letter tailored to it, in your real
voice, that does not sound like AI. Bilingual (English / Spanish), MIT licensed,
and bring-your-own-key: the app never ships a model API key of its own.

Full scope lives in [PROJECT.md](./PROJECT.md). The design system is
[DESIGN.md](./DESIGN.md). Engineering rules are [CLAUDE.md](./CLAUDE.md).

## Status

The golden path is built and live on `main`: sign up, add a model key
(Anthropic, OpenAI, Google, or any OpenAI-compatible host), upload a CV, paste
a posting, and get a tailored resume and cover letter you can download.
Onboarding, the Applications list, account and key management, and the
privacy/terms pages are all in place.

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

Aplica calls your model provider (Anthropic, OpenAI, Google, or any
OpenAI-compatible host) with a key you supply. That key stays in your own
database: encrypted at rest with AES-256-GCM, used server-side only, never
sent back to the browser and never logged. You can delete it in one click.
The details are in PROJECT.md section 6.

## Uploading a CV, and Vercel's Hobby plan

Parsing a CV is one long model call: 55.52s measured on a real one-page CV,
and 43-51s across two synthetic two-page runs against denser input, all under
Vercel's 60-second Hobby cap but without much room to spare. `POST /api/cv`
ships on Hobby anyway (`maxDuration = 60` in `src/app/api/cv/route.ts`), and
races the model call against its own deadline so a near-timeout ends in a
calm, specific message instead of Vercel silently killing the connection.

**If your CV is denser than that** (a long two-page CV, a lot of roles), the
parse can still run past what Hobby allows. Two ways around it if you hit
that:

- **The CLI fallback**, which has no time limit at all:
  ```bash
  APLICA_DEV_PROVIDER=google APLICA_DEV_API_KEY=your-key \
    npm run parse:cv -- ./your-cv.pdf --save your-user-id
  ```
  Prints the parsed profile to stdout and, with `--save`, writes it straight
  into your account the same way the web upload does. See
  `scripts/parse-cv.mts` for every flag.
- **Move to Pro.** Two changes, nothing else about the route: raise
  `maxDuration` in `src/app/api/cv/route.ts` from `60` to `300`, and upgrade
  the Vercel project's plan. The prompt (`src/prompts/parse.ts`) does not
  change; a two-call split that would fit Hobby with real margin is scoped
  in `SLICE-11.md` and deliberately not built.

## License

MIT. See [LICENSE](./LICENSE).
