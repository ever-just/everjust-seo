import { env } from "cloudflare:workers";
import { genericOAuth, organization } from "better-auth/plugins";
import { baseAuthOptions } from "@/lib/auth-options";
import { GA4_OAUTH_PROVIDER_ID, GA4_OAUTH_SCOPES } from "@/shared/ga4";
import { GSC_OAUTH_PROVIDER_ID, GSC_OAUTH_SCOPES } from "@/shared/gsc";

export function createBaseAuthConfig() {
  return {
    ...baseAuthOptions,
    advanced: {
      ipAddress: {
        // On Cloudflare Workers the client IP arrives in CF-Connecting-IP;
        // x-forwarded-for (better-auth's default) is absent, so without this
        // getIp() returns null and rate limiting is silently skipped on every
        // /api/auth endpoint. Header lookup is case-insensitive.
        ipAddressHeaders: ["cf-connecting-ip"],
      },
    },
    account: {
      // Encrypt OAuth access/refresh tokens at rest in D1. Also covers the
      // google social-login tokens; the key derives from BETTER_AUTH_SECRET.
      encryptOAuthTokens: true,
      accountLinking: {
        // Google verifies email ownership, so trust it to auto-link on sign-in:
        // "Continue with Google" logs the user into an existing same-email
        // account (or creates one) instead of failing with account_not_linked.
        enabled: true,
        trustedProviders: ["google"],
        // Allow connecting a Google account whose email differs from the
        // logged-in user's (agency/freelancer managing a client's property).
        allowDifferentEmails: true,
      },
    },
    plugins: [
      // Organizations are the tenant boundary for this self-host multi-tenant
      // build: each org is a workspace, and users own the full lifecycle —
      // create workspaces, invite teammates, and delete workspaces they own.
      //
      // Upstream locked all three down (allowUserToCreateOrganization: false,
      // invitationLimit: 0, disableOrganizationDeletion: true) because on the
      // hosted SaaS each org is its own Autumn billing customer with its own
      // credit grant, so user-initiated create/delete could mint unlimited
      // fresh grants and multi-org membership broke the "one user, one
      // workspace" billing invariant. Here billing is a no-op unless Autumn is
      // configured (see isBillingEnabled / src/server/billing), so none of that
      // applies and the tenant model is genuinely multi-org.
      //
      // Every user still gets a default workspace created server-side at signup
      // via `auth.api.createOrganization({ body: { userId } })` — a better-auth
      // "system action" (no session + userId in body) exempt from
      // allowUserToCreateOrganization — so the bootstrap keeps working.
      //
      // NOTE (follow-up, tracked in docs/SELFHOST_MULTITENANT.md): MCP API keys
      // still scope/bill to the user's first org rather than being derived
      // per-request from the project. Harden that (project-level authz, keys
      // stay user-scoped with no key→workspace binding) before exposing this to
      // untrusted multi-tenant use with billing enabled.
      organization({
        allowUserToCreateOrganization: true,
        invitationLimit: 25,
        disableOrganizationDeletion: false,
      }),
      genericOAuth({
        config: [
          {
            providerId: GSC_OAUTH_PROVIDER_ID,
            clientId: env.GOOGLE_CLIENT_ID?.trim() ?? "",
            clientSecret: env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
            discoveryUrl:
              "https://accounts.google.com/.well-known/openid-configuration",
            scopes: [...GSC_OAUTH_SCOPES],
            accessType: "offline", // request a refresh token
            prompt: "select_account consent",
            pkce: true,
          },
          {
            providerId: GA4_OAUTH_PROVIDER_ID,
            clientId: env.GOOGLE_CLIENT_ID?.trim() ?? "",
            clientSecret: env.GOOGLE_CLIENT_SECRET?.trim() ?? "",
            discoveryUrl:
              "https://accounts.google.com/.well-known/openid-configuration",
            scopes: [...GA4_OAUTH_SCOPES],
            accessType: "offline",
            prompt: "select_account consent",
            pkce: true,
          },
        ],
      }),
    ],
  };
}
