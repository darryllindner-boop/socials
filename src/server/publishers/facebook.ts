import type { Platform } from "@/core/types";
import {
  composeText,
  type OAuthExchangeInput,
  type OAuthStartInput,
  type OAuthTokens,
  type Publisher,
  type PublishInput,
  type PublishResult,
} from "./publisher";

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Facebook Page publisher (Graph API).
 *
 * Requirements: a Meta app with `pages_manage_posts` + `pages_read_engagement`,
 * App Review approval, and a Page access token. `externalId` is the Page id and
 * `accessToken` must be the Page (not user) token.
 */
export class FacebookPublisher implements Publisher {
  readonly platform: Platform = "facebook";
  readonly scopes = ["pages_show_list", "pages_manage_posts", "pages_read_engagement"];
  readonly requirements =
    "Meta app with pages_manage_posts (App Review required). Publishes to a Facebook Page using a Page access token.";

  authorizationUrl(input: OAuthStartInput): string {
    const url = new URL("https://www.facebook.com/v21.0/dialog/oauth");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("state", input.state);
    url.searchParams.set("scope", input.scopes.join(","));
    return url.toString();
  }

  async exchangeCode(input: OAuthExchangeInput): Promise<OAuthTokens> {
    // Meta uses a GET endpoint for the code exchange.
    const url = new URL(`${GRAPH}/oauth/access_token`);
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("client_secret", input.clientSecret);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("code", input.code);

    const res = await fetch(url.toString());
    const raw = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(`Meta token exchange failed (${res.status}): ${JSON.stringify(raw)}`);
    }
    const expiresIn = typeof raw.expires_in === "number" ? raw.expires_in : undefined;
    return {
      accessToken: String(raw.access_token ?? ""),
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
      raw,
    };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    if (!input.accessToken) {
      return { ok: false, notConfigured: true, error: "Facebook Page not connected." };
    }
    const message = composeText(input.body, input.hashtags);
    const res = await fetch(`${GRAPH}/${input.externalId}/feed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, access_token: input.accessToken }),
    });
    const data = (await res.json()) as { id?: string };
    if (!res.ok) {
      return { ok: false, error: `Facebook publish failed (${res.status}): ${JSON.stringify(data)}` };
    }
    return { ok: true, externalId: data.id };
  }
}
