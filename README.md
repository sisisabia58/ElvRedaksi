# Redaksi

Redaksi is a self-hosted Instagram carousel newsroom. RSS sources come in. Four agents (Scout, Analis, Copywriter, Designer) draft a branded carousel. A human approves. Publishing uses Meta's official Instagram API. A public bio page sends readers back to the source article.

There is no fully automatic mode. Visuals are generated in the app or uploaded by the operator. The app does not download or hotlink a news photo.

## Local

```bash
npm install
npm test
npm run dev
```

`npm run dev` and `npm start` listen on port **43123**.

Without `DATABASE_URL`, the server uses an embedded PGlite database and applies the schema itself. Unit tests keep using an isolated PGlite through `createTestSql()`. They do not open Postgres.

Copy `.env.example` to `.env` when you want real services. Leave `CONTACT_WA` empty and the sales page renders no WhatsApp button. Leave `NEXT_PUBLIC_BATCH_NOTE` unset and the sales page renders no scarcity banner. Do not hardcode a phone number.

The three sample slides on the sales page are static PNGs for a fixture article titled `Contoh carousel`. Regenerate them with:

```bash
npx tsx scripts/sample-slides.ts
```

## Demo admin

On boot the app applies the schema, seeds the default brand and Brain notes, and enqueues one `scout.scan` and one `insights.sync` when no unfinished row of that name exists.

`SEED_DEMO=1` inserts `admin@redaksi.local` / `redaksi-dev-only` only when that email is missing and `NODE_ENV` is not `production`. The password is stored with `hashPassword` (scrypt). If `SEED_DEMO=1` and `NODE_ENV=production`, the demo admin is not inserted.

```bash
SEED_DEMO=1 npm run dev
```

Then sign in at `http://127.0.0.1:43123/login`. Login is invite-only after that. An admin creates the rest of the team from Tim & Akses.

## OpenAI and Meta

Defaults are local fakes: `LLM_PROVIDER=demo` and `META_PROVIDER=fake`. Demo scoring and copy stay on the machine. Fake publish does not call Instagram.

Demo mode does not call a model. Scoring and copy are fixed local payloads (every passing topic scores 80 and is tagged marketing). Slide images are screenshots of the in-app HTML templates (Playwright), not an image API. Demo rows are stored with `model = demo` and `cost_usd = 0`. The studio header shows those figures as simulasi and $0 while `LLM_PROVIDER` is `demo`. Pengaturan names the active provider and model.

To use Gemini for scoring and copy, set `LLM_PROVIDER=gemini` and `GEMINI_API_KEY`. Optional: `GEMINI_MODEL` (default `gemini-3.5-flash-lite`, the current cheap fast model for new projects), `GEMINI_INPUT_USD_PER_MTOK` (default `0.30`), and `GEMINI_OUTPUT_USD_PER_MTOK` (default `2.50`). Calls go to `generativelanguage.googleapis.com` and ask for JSON. `gemini-2.5-flash` is still a valid id, but Google limits it to accounts that already used the 2.5 family.

To use OpenAI for scoring and copy, set:

```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini
OPENAI_INPUT_USD_PER_MTOK=0.15
OPENAI_OUTPUT_USD_PER_MTOK=0.60
```

To publish for real, set `META_PROVIDER=meta`, set `PUBLIC_BASE_URL` to the public https origin Instagram can fetch, and save a long-lived Instagram Login token in Pengaturan. The account must be Business or Creator, with `instagram_business_basic`, `instagram_business_content_publish`, and `instagram_business_manage_insights`. Calls go to `https://graph.instagram.com/v26.0`. A short-lived token is rejected: exchanging it needs an app secret, which this app does not store. The token is encrypted at rest when `TOKEN_ENCRYPTION_KEY` or `CRON_SECRET` is set. A daily job refreshes it only while `META_PROVIDER=meta`. TikTok and Reels are not part of this product.

## Human approval

A worker may publish only after a human has set the draft to `scheduled`. Moving `needs_review` straight to posting is rejected. The overview chip stays `Mode: Semi-otomatis`.

## No news photos

Every topic stores the article URL and the source name. Every slide renders `Sumber: {sourceName}`. Covers are geometric, generated in the template, or an image the operator uploaded. Do not point the renderer at a news photo URL.

## Docker

Postgres 16, the Next.js app, and a one-minute cron live in Compose. Assign `CRON_SECRET` yourself, export it, and only then run `docker compose up --build`. The value is required, it must not be a value from this repository, and Compose stops if the variable is unset or empty. The web port is bound to localhost (`127.0.0.1:43123`).

```bash
export CRON_SECRET
docker compose up --build
```

- `db`: user, database, and password `redaksi`, volume `pg`
- `web`: `127.0.0.1:43123:43123`, `DATABASE_URL=postgres://redaksi:redaksi@db:5432/redaksi`, `LLM_PROVIDER=demo`, `META_PROVIDER=fake`, `PUBLIC_BASE_URL=http://127.0.0.1:43123`, `SEED_DEMO=1`
- `cron`: `POST http://web:43123/api/cron` every 60 seconds with `Authorization: Bearer $CRON_SECRET`

`npm start` inside the image runs with `NODE_ENV=production`, so the demo admin is not created even though Compose sets `SEED_DEMO=1`. For a local login, use `SEED_DEMO=1 npm run dev` against the database you want. On a VPS, create the first admin with a non-production boot, then run the container in production and unset `SEED_DEMO`.

The cron route and `instrumentation.ts` both call boot before serving work, so a restarted container applies the schema again. Boot is safe to run more than once.
