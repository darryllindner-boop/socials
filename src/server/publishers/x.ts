import type { Platform } from "@/core/types";
import {
  composeText,
  oauth2Exchange,
  type OAuthExchangeInput,
  type OAuthStartInput,
  type OAuthTokens,
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
}
