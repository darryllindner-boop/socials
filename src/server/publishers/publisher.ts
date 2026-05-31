import type { Platform } from "@/core/types";

/**
 * Publisher abstraction: one implementation per platform.
 *
 * Phase 0 fully implements the *safe* parts — building the OAuth authorize URL
 * and exchanging the auth code for tokens (standard OAuth2) — and provides a
 * guarded `publish` that NEVER fakes success. Real publishing requires each
 * platform app to be approved (see `requirements`), so until tokens exist the
 * publisher reports a clear, non-destructive error instead of pretending.
 */

export interface OAuthStartInput {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
}

export interface OAuthExchangeInput {
  clientId: string;
  clientSecret: string;
  code: string;
  redirectUri: string;
}

export interface OAuthRefreshInput {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

/**
 * The real identity of a connected account, resolved by calling the platform
 * after token exchange. `externalId` is what `publish` posts as (e.g. a
 * LinkedIn person URN or a Facebook Page id).
 *
 * `accessToken` is an optional override: some platforms publish with a token
 * that differs from the one returned by the OAuth code exchange. For Meta, the
 * code exchange yields a *user* token, but posting to a Page requires the
 * *Page* access token discovered during identity resolution — so fetchIdentity
 * returns it here and the callback stores it in place of the user token.
 */
export interface AccountIdentity {
  externalId: string;
  displayName: string;
  metadata?: Record<string, unknown>;
  /** Token to store/publish with, if different from the OAuth-exchange token. */
  accessToken?: string;
  /** Expiry of the override token (Page tokens from long-lived user tokens don't expire). */
  tokenExpiresAt?: Date;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  /** Raw provider payload for storing platform-specific ids. */
  raw: Record<string, unknown>;
}

export interface PublishInput {
  body: string;
  hashtags: string[];
  /** Decrypted access token for the connected account. */
  accessToken: string;
  /** Platform account/page id to publish as. */
  externalId: string;
  /** Optional platform metadata (e.g. IG business id). */
  metadata?: Record<string, unknown>;
  /** Optional media URLs (required for Instagram). */
  mediaUrls?: string[];
}

export interface PublishResult {
  ok: boolean;
  /** Platform's id for the created post, on success. */
  externalId?: string;
  /** Human-readable error, on failure. */
  error?: string;
  /** True when failure is due to missing setup/approval rather than a transient fault. */
  notConfigured?: boolean;
}

export interface Publisher {
  readonly platform: Platform;
  /** OAuth scopes this integration needs. */
  readonly scopes: string[];
  /** Human-readable note about platform approval requirements (shown in UI). */
  readonly requirements: string;
  authorizationUrl(input: OAuthStartInput): string;
  exchangeCode(input: OAuthExchangeInput): Promise<OAuthTokens>;
  publish(input: PublishInput): Promise<PublishResult>;
  /**
   * Resolve the connected account's real id + display name after token
   * exchange. Optional: platforms that haven't implemented it fall back to a
   * placeholder until wired (publishing is still guarded by a real token).
   */
  fetchIdentity?(accessToken: string, raw: Record<string, unknown>): Promise<AccountIdentity>;
  /** Refresh an access token using a refresh token (platforms that support it). */
  refreshAccessToken?(input: OAuthRefreshInput): Promise<OAuthTokens>;
}

/** Compose body + hashtags into a single string for platforms that inline tags. */
export function composeText(body: string, hashtags: string[]): string {
  if (hashtags.length === 0) return body;
  return `${body}\n\n${hashtags.join(" ")}`;
}

/** Thrown when a publish is attempted without the platform app being usable. */
export class NotConfiguredError extends Error {
  constructor(platform: Platform, detail: string) {
    super(`[${platform}] not configured: ${detail}`);
    this.name = "NotConfiguredError";
  }
}

/** Standard OAuth2 authorization-code-grant token exchange (used by several platforms). */
export async function oauth2Exchange(
  tokenUrl: string,
  input: OAuthExchangeInput,
  extraParams: Record<string, string> = {},
): Promise<OAuthTokens> {
  const params = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    ...extraParams,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const raw = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${JSON.stringify(raw)}`);
  }

  const expiresIn = typeof raw.expires_in === "number" ? raw.expires_in : undefined;
  return {
    accessToken: String(raw.access_token ?? ""),
    refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : undefined,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
    raw,
  };
}

/** Standard OAuth2 refresh-token grant (used by LinkedIn, X, ...). */
export async function oauth2Refresh(
  tokenUrl: string,
  input: OAuthRefreshInput,
  extraParams: Record<string, string> = {},
): Promise<OAuthTokens> {
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    ...extraParams,
  });

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  const raw = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    throw new Error(`Token refresh failed (${res.status}): ${JSON.stringify(raw)}`);
  }

  const expiresIn = typeof raw.expires_in === "number" ? raw.expires_in : undefined;
  return {
    accessToken: String(raw.access_token ?? ""),
    // Some providers rotate refresh tokens; keep the new one when present.
    refreshToken: typeof raw.refresh_token === "string" ? raw.refresh_token : input.refreshToken,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
    raw,
  };
}
