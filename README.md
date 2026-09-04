# EVERJUST SEO

A self-hosted, multi-tenant SEO platform for teams who want their ranking data on their own infrastructure.

**Status:** Production · maintained fork of [OpenSEO](https://github.com/every-app/open-seo) · public

[![license](https://img.shields.io/badge/license-MIT-1D1D1F?style=flat)](./LICENSE)
[![live](https://img.shields.io/badge/live-seo.everjust.app-1D1D1F?style=flat)](https://seo.everjust.app)

|  |  |
|---|---|
| **What it is** | Self-hosted SEO workspace — keywords, rankings, backlinks, site audits, plus an MCP server |
| **Who it's for** | Teams and agents that need SEO data they own, not a seat-priced dashboard |
| **Live at** | [seo.everjust.app](https://seo.everjust.app) |
| **Stack** | TypeScript · React + TanStack Start · Drizzle ORM (Cloudflare D1 or Postgres) · Cloudflare Workers or Docker |
| **Status** | Production · upstream v0.1.6 · deployment branch `feat/multitenant-selfhost`, 4 commits ahead of `main` |

## What it is

Commercial SEO suites price per seat, hold your crawl history, and give an AI agent nothing to
call. This repository is EVERJUST's fork of [OpenSEO](https://openseo.so), an open-source SEO
tool that runs on infrastructure you control and bills SEO data through your own
[DataForSEO](https://dataforseo.com) key — you pay per query instead of per month.

The fork exists for one reason: upstream's hosted mode is a single-tenant SaaS build, wired to a
billing provider, a captcha and a transactional email vendor. EVERJUST runs it as a multi-tenant
workspace for several organizations at once, with none of those three services present. The
`feat/multitenant-selfhost` branch makes each of them optional without changing behaviour when
they *are* configured, and rebrands the user-facing surfaces. `main` tracks upstream so the fork
can keep merging it.

Application credit belongs to [every-app/open-seo](https://github.com/every-app/open-seo). What is
EVERJUST's here is the deployment, the tenancy model, and the branch that made both possible.

## What it does

- **Keyword research** — volume, difficulty and clustering, sourced from DataForSEO
- **Rank tracking** — scheduled position checks, national or local, run as durable workflows
- **Site audits** — a crawler that reports technical-SEO issues, with `badseo/` as its fixture
- **Backlinks and competitors** — referring-domain profiles and competitive landscape views
- **Google integrations** — Search Console and GA4, connected over OAuth
- **Agent access** — an MCP server so Claude Code and other agents query the same data directly
- **Agent skills** — 9 packaged SEO workflows under `plugins/openseo/skills/`

## Quickstart

The fastest path is Docker. You need a DataForSEO key ([how to get one](./docs/DATAFORSEO_API_KEY.md)).

```bash
git clone https://github.com/ever-just/everjust-seo.git && cd everjust-seo
cp .env.example .env          # set DATAFORSEO_API_KEY
docker compose up -d          # http://localhost:3001
```

For the multi-tenant configuration EVERJUST runs, follow
[`docs/SELFHOST_MULTITENANT.md`](https://github.com/ever-just/everjust-seo/blob/feat/multitenant-selfhost/docs/SELFHOST_MULTITENANT.md)
on the `feat/multitenant-selfhost` branch.

## How it works

A single TanStack Start application serves both the React client and the server functions. Drizzle
ORM talks to either Cloudflare D1 or Postgres from the same query code, selected by
`DATABASE_PROVIDER`. Better Auth handles sessions in three modes — Cloudflare Access, local
no-auth, or hosted email/password — and the MCP server reuses those same sessions through
API keys, so an agent sees exactly the projects its user can see.

### Repository layout

```text
.
├── src/client/       # React UI, one directory per feature
├── src/server/       # server functions, MCP server, workflows, billing, GDPR
├── src/routes/       # TanStack file-based routes (app, auth, api)
├── src/db/           # Drizzle schema — D1 under db/, Postgres under db/pg/
├── drizzle/          # SQLite/D1 migrations   (drizzle-pg/ for Postgres)
├── plugins/openseo/  # Claude Code plugin: MCP config + 9 agent skills
├── badseo/           # deliberately broken test site, fixture for the audit engine
├── web/              # marketing site and docs (separate pnpm workspace)
├── specs/            # numbered design specs, one per feature
├── runbooks/         # D1→Postgres migration, GDPR erasure
└── docs/             # self-hosting guides (Docker, Cloudflare, Google, Postgres)
```

**Development:** Node 22, pnpm 10.30.1.

```bash
pnpm install
pnpm dev              # http://localhost:3001
pnpm test             # vitest — 133 test files under src/
pnpm run ci:check     # prettier, knip, tsc, oxlint — what CI runs
```

## Configuration

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATAFORSEO_API_KEY` | yes | — | All SEO data. Base64 of `login:password`. |
| `AUTH_MODE` | no | `cloudflare_access` | `cloudflare_access`, `local_noauth`, or `hosted` |
| `DATABASE_PROVIDER` | no | `d1` | `d1` or `postgres` |
| `BETTER_AUTH_SECRET` | hosted mode | — | ≥32 chars; also encrypts stored OAuth tokens |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | for Google | — | Social login and Search Console |
| `OPENROUTER_API_KEY` | no | — | Enables the in-app SEO agent; hidden if unset |
| `ALLOWED_HOST` | behind a proxy | — | Required for any non-localhost host |

See [`.env.example`](./.env.example) for the full list. Secrets are supplied at deploy time and
are never committed.

## Known limitations

- **Tenant isolation rests on one gate.** Project access is checked once per request; child tables
  carry no `organizationId` column and there is no row-level security. Add defense in depth before
  opening an instance to mutually untrusted tenants.
- **MCP API keys resolve to the user's first organization** rather than to the project named in the
  tool call. Fine for one workspace per user; not yet correct for many.
- **`main` tracks upstream.** EVERJUST's changes live on `feat/multitenant-selfhost`, so `main` is
  useful for merging, not for deploying.

## License

[MIT](./LICENSE). Upstream copyright remains with the [OpenSEO](https://github.com/every-app/open-seo)
authors; fork changes are EVERJUST's under the same licence.
