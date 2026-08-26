# Self-Host Multi-Tenant Mode

This fork can run as a self-hostable, organization-scoped multi-tenant app (similar to [getprobo/probo](https://github.com/getprobo/probo)) in `AUTH_MODE=hosted` **without** an Autumn/Stripe billing account and **without** Cloudflare Turnstile or Loops email.

Upstream OpenSEO's `hosted` mode is the SaaS build: every organization is an Autumn billing customer, users get exactly one workspace, and signup is guarded by Turnstile + Loops email verification. This document describes the changes that make all of that **optional** while preserving the exact upstream behavior whenever those services **are** configured.

> The tenant boundary is the organization. Each org is a workspace with its own projects, members, and API keys. See the two follow-ups at the bottom before exposing this to untrusted tenants.

## What changed

### 1. Organizations are unlocked (multi-tenant)

`src/lib/auth-config.ts` — the Better Auth `organization({...})` plugin now allows the full workspace lifecycle:

| Option                          | Upstream (SaaS lock) | This fork |
| ------------------------------- | -------------------- | --------- |
| `allowUserToCreateOrganization` | `false`              | `true`    |
| `invitationLimit`               | `0`                  | `25`      |
| `disableOrganizationDeletion`   | `true`               | `false`   |

Users can create workspaces, invite teammates, and delete workspaces they own. Every user still gets a default workspace created server-side at signup (a Better Auth "system action" exempt from `allowUserToCreateOrganization`), so the bootstrap is unchanged.

Upstream locked these down because each org is its own Autumn credit grant, so user-initiated create/delete could mint unlimited fresh grants and multi-org membership broke the "one user, one workspace" billing invariant. With billing a no-op (below), none of that applies.

### 2. Billing is a no-op when Autumn is not configured

A single helper `isBillingEnabled()` in `src/server/billing/autumn.ts` returns `true` **iff** `AUTUMN_SECRET_KEY` is present and non-empty (and `BILLING_DISABLED` is not `"true"`). When it returns `false`, every credit gate short-circuits to "full access / unlimited" and no Autumn SDK call is ever made — `getRequiredEnvValue("AUTUMN_SECRET_KEY")` is never reached, so nothing throws.

When `AUTUMN_SECRET_KEY` **is** set, behavior is byte-for-byte identical to upstream.

Gated functions (`src/server/billing/subscription.ts`):

| Function                                            | Disabled behavior                                                                                       |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `getOrCreateOrganizationCustomer`                   | Returns `{ id: organizationId }` with no Autumn/KV round trip                                           |
| `assertUsageCreditsAvailable`                       | Never throws `INSUFFICIENT_CREDITS`; returns unlimited `monthlyRemaining`                               |
| `getUsageCreditsRemaining` (private, shared reader) | Reports effectively-unlimited credits — this is why `assert` and `checkUsageCreditsDepleted` both no-op |
| `checkUsageCreditsDepleted`                         | Returns `{ depleted: false }` (its confirm-path Autumn read is unreachable)                             |
| `trackUsageCreditSpend`                             | No-op (nothing to meter or deduct)                                                                      |
| `customerHasPaidPlan`                               | Returns `true` (paid-tier behavior / full limits)                                                       |
| `customerHasManagedAccess`                          | Returns `true` (no `PAYMENT_REQUIRED` gate)                                                             |

Other neutralized call sites (same `isBillingEnabled()` guard, Autumn code kept intact, not deleted):

- `src/server/billing/autumn-webhook.ts` — `handleAutumnWebhookRequest` returns a benign `404` when billing is disabled instead of throwing on the missing `AUTUMN_WEBHOOK_SECRET`.
- `src/server/workflows/RankCheckWorkflow.ts` — the rank-check credit ceiling (`prepareRankCheckKeywords`) calls `autumn.check` directly; it now runs only when `isBillingEnabled() && isHostedServerAuthMode()`.

The DataForSEO metering hot path is `meterDataforseoCall` in `src/server/lib/dataforseo/client.ts`. In hosted mode it calls `getOrCreateOrganizationCustomer` → `assertUsageCreditsAvailable` → (fetch) → `trackUsageCreditSpend`; with billing disabled each of those is now a no-op, so DataForSEO calls run unmetered.

### 3. Email + captcha are already optional under email-bypass

No code change was required for hosted mode to run without Loops or Turnstile — the existing logic already supports it, verified by the preflight smoke test:

- **Turnstile:** `hasHostedTurnstileConfig` (`src/lib/auth-turnstile.ts`) returns `true` when no `TURNSTILE_SITE_KEY` is set, and the captcha plugin in `src/lib/auth.ts` is only added when `TURNSTILE_SECRET_KEY` is present. Unset ⇒ captcha simply off.
- **Email:** `hasHostedAuthConfig` (`src/lib/auth.ts`) accepts `BYPASS_EMAIL_VERIFICATION=true` in place of the Loops config, and the `emailVerification` block is only wired up when bypass is off.
- **Preflight** (`src/lib/selfhost-preflight.ts`) requires only `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` for hosted mode — never Loops or Turnstile.

Nothing was weakened for the case where bypass is **not** set: with `BYPASS_EMAIL_VERIFICATION` unset, Loops is still required for verification and password-reset email, exactly as upstream.

## Environment variables

Minimum for a hosted multi-tenant instance with no billing/email/captcha:

| Variable                                    | Required           | Notes                                                                 |
| ------------------------------------------- | ------------------ | --------------------------------------------------------------------- |
| `AUTH_MODE=hosted`                          | yes                | Set in **both** the client build env and the server runtime.          |
| `BETTER_AUTH_SECRET`                        | yes                | ≥ 32 chars; also encrypts stored OAuth tokens.                        |
| `BETTER_AUTH_URL`                           | yes                | `https://…` (or `http://localhost`).                                  |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | yes                | Google social login (hosted-only) and Search Console.                 |
| `BYPASS_EMAIL_VERIFICATION=true`            | yes (for no-email) | Skips email verification; makes Loops optional.                       |
| `DATABASE_PROVIDER`                         | as needed          | `d1` (default) or `postgres`; queries stay compatible with both.      |
| `DATAFORSEO_API_KEY`                        | for SEO data       | base64 of `login:password`. Without it, SEO features are unavailable. |

Optional — enabling any of these restores the corresponding upstream behavior:

| Variable                                                                                        | Effect when set                                                        |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `AUTUMN_SECRET_KEY`                                                                             | **Turns billing back on** — all credit gates enforce again.            |
| `BILLING_DISABLED=true`                                                                         | Force billing off even if `AUTUMN_SECRET_KEY` is present.              |
| `AUTUMN_WEBHOOK_SECRET`                                                                         | Verifies the Autumn billing webhook (only used when billing is on).    |
| `LOOPS_API_KEY`, `LOOPS_TRANSACTIONAL_VERIFY_EMAIL_ID`, `LOOPS_TRANSACTIONAL_RESET_PASSWORD_ID` | Transactional email (verification, password reset).                    |
| `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`                                                   | Signup captcha. If a site key is set, the matching secret is required. |
| `OPENROUTER_API_KEY`                                                                            | Enables the in-app SEO agent (SAM) and onboarding chat.                |
| `ALLOWED_HOST`                                                                                  | Required behind a reverse proxy/tunnel (non-localhost).                |

## Known follow-ups (do before untrusted multi-tenant use)

These were intentionally **not** addressed here and are required hardening before opening the instance to mutually-untrusted tenants:

1. **MCP API keys scope/bill to the user's first org.** API-key requests are not derived per-tool-call from the target project; they resolve to the user's first organization. For true multi-tenant use, move API-key requests to project-level authz (org derived per tool call from the project; keys stay user-scoped with no key→workspace binding). Relevant: `src/lib/auth-api-key.ts`, the MCP tooling under `src/server/mcp/`.

2. **Child-table tenant isolation relies on a single per-request gate, with no org column / RLS.** Access to a project (and everything under it) is authorized by one `ProjectRepository.getProjectForOrganization(projectId, organizationId)` check per request (see `src/server.ts`). Child tables carry no `organizationId` column and there is no row-level security, so a missed gate anywhere leaks across tenants. Add defense-in-depth (an org column on child tables and/or Postgres RLS) before relying on this boundary against untrusted tenants.
