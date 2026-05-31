import type { Platform } from "@/core/types";
import {
  composeText,
  oauth2Exchange,
  type AccountIdentity,
  type MetricsInput,
  type OAuthExchangeInput,
  type OAuthRefreshInput,
  type OAuthStartInput,
  type OAuthTokens,
  type PostMetrics,
  type Publisher,
  type PublishInput,
  type PublishResult,
} from "./publisher";

/**
 * X (Twitter) publisher (API v2, OAuth 2.0 with PKCE).
 *
 * Requirements: an X developer app on a paid tier that grants write access.
 * Note: the free tier is severely limited; posting typically needs Basic+.
 * PKCE code_verifier handling is managed by the OAuth route, which passes it
 * through `extraParams`.
 */
export class XPublisher implements Publisher {
  readonly platform: Platform = "x";
  readonly scopes = ["tweet.read", "tweet.write", "users.read", "offline.access"];
  readonly requirements =
    "X developer app on a paid tier (Basic+) with tweet.write. OAuth 2.0 PKCE. Free tier generally cannot publish.";

  authorizationUrl(input: OAuthStartInput): string {
    const url = new URL("https://twitter.com/i/oauth2/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("state", input.state);
    url.searchParams.set("scope", input.scopes.join(" "));
    // PKCE: the route supplies a challenge via state storage; placeholder here.
    url.searchParams.set("code_challenge", "challenge");
    url.searchParams.set("code_challenge_method", "plain");
    return url.toString();
  }

  exchangeCode(input: OAuthExchangeInput): Promise<OAuthTokens> {
    return oauth2Exchange("https://api.twitter.com/2/oauth2/token", input);
  }

  /**
   * X confidential clients must authenticate the token endpoint with HTTP Basic
   * auth, so the refresh is done explicitly rather than via the shared helper.
   */
  async refreshAccessToken(input: OAuthRefreshInput): Promise<OAuthTokens> {
    const basic = Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64");
    const res = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: input.refreshToken,
        client_id: input.clientId,
      }).toString(),
    });
    const raw = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`X token refresh failed (${res.status}): ${JSON.stringify(raw)}`);
    }
    const expiresIn = typeof raw.expires_in === "number" ? raw.expires_in : undefined;
    return {
      accessToken: String(raw.access_token ?? ""),
      refreshToken:
        typeof raw.refresh_token === "string" ? raw.refresh_token : input.refreshToken,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
      raw,
    };
  }

  /** Resolve the authenticated user's id + handle via /2/users/me. */
  async fetchIdentity(accessToken: string): Promise<AccountIdentity> {
    const res = await fetch("https://api.twitter.com/2/users/me", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`X /users/me failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as { data?: { id?: string; username?: string; name?: string } };
    const id = data.data?.id;
    if (!id) {
      throw new Error("X /users/me returned no id.");
    }
    return {
      externalId: id,
      displayName: data.data?.username ? `@${data.data.username}` : (data.data?.name ?? "X account"),
      metadata: { username: data.data?.username },
    };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    if (!input.accessToken) {
      return { ok: false, notConfigured: true, error: "X account not connected." };
    }
    const text = composeText(input.body, input.hashtags);
    const res = await fetch("https://api.twitter.com/2/tweets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ text }),
    });
    const data = (await res.json()) as { data?: { id?: string } };
    if (!res.ok) {
      return { ok: false, error: `X publish failed (${res.status}): ${JSON.stringify(data)}` };
    }
    return { ok: true, externalId: data.data?.id };
  }

  /** Engagement via the tweet's public_metrics (likes, retweets, replies, impressions). */
  async fetchMetrics(input: MetricsInput): Promise<PostMetrics> {
    const url = new URL(`https://api.twitter.com/2/tweets/${input.postExternalId}`);
    url.searchParams.set("tweet.fields", "public_metrics");
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${input.accessToken}` },
    });
    const data = (await res.json()) as {
      data?: {
        public_metrics?: {
          like_count?: number;
          reply_count?: number;
          retweet_count?: number;
          quote_count?: number;
          impression_count?: number;
        };
      };
    };
    if (!res.ok) {
      throw new Error(`X tweet lookup failed (${res.status}): ${JSON.stringify(data)}`);
    }
    const m = data.data?.public_metrics ?? {};
    return {
      likes: m.like_count,
      comments: m.reply_count,
      shares: (m.retweet_count ?? 0) + (m.quote_count ?? 0),
      impressions: m.impression_count,
      fetchedAt: new Date().toISOString(),
      raw: data as Record<string, unknown>,
    };
  }
}
