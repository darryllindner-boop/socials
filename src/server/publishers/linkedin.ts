import type { Platform } from "@/core/types";
import {
  composeText,
  oauth2Exchange,
  oauth2Refresh,
  type AccountIdentity,
  type OAuthExchangeInput,
  type OAuthRefreshInput,
  type OAuthStartInput,
  type OAuthTokens,
  type Publisher,
  type PublishInput,
  type PublishResult,
} from "./publisher";

/**
 * LinkedIn publisher (member share via UGC Posts API).
 *
 * Requirements: a LinkedIn Developer app with the "Share on LinkedIn" and
 * "Sign In with LinkedIn using OpenID Connect" products. Posting to Company
 * Pages additionally needs the "Community Management API" (partner approval).
 */
export class LinkedInPublisher implements Publisher {
  readonly platform: Platform = "linkedin";
  readonly scopes = ["openid", "profile", "w_member_social"];
  readonly requirements =
    "LinkedIn app with 'Share on LinkedIn' product. Company Page posting requires Community Management API approval.";

  authorizationUrl(input: OAuthStartInput): string {
    const url = new URL("https://www.linkedin.com/oauth/v2/authorization");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", input.clientId);
    url.searchParams.set("redirect_uri", input.redirectUri);
    url.searchParams.set("state", input.state);
    url.searchParams.set("scope", input.scopes.join(" "));
    return url.toString();
  }

  exchangeCode(input: OAuthExchangeInput): Promise<OAuthTokens> {
    return oauth2Exchange("https://www.linkedin.com/oauth/v2/accessToken", input);
  }

  refreshAccessToken(input: OAuthRefreshInput): Promise<OAuthTokens> {
    // LinkedIn issues refresh tokens only to approved apps; same token endpoint.
    return oauth2Refresh("https://www.linkedin.com/oauth/v2/accessToken", input);
  }

  /**
   * Resolve the member identity via OpenID Connect userinfo. Returns the author
   * URN used by the UGC Posts API (`urn:li:person:{sub}`).
   */
  async fetchIdentity(accessToken: string): Promise<AccountIdentity> {
    const res = await fetch("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) {
      throw new Error(`LinkedIn userinfo failed (${res.status}): ${await res.text()}`);
    }
    const me = (await res.json()) as {
      sub?: string;
      name?: string;
      given_name?: string;
      family_name?: string;
    };
    if (!me.sub) {
      throw new Error("LinkedIn userinfo returned no subject id.");
    }
    const displayName =
      me.name || [me.given_name, me.family_name].filter(Boolean).join(" ") || "LinkedIn member";
    return {
      externalId: `urn:li:person:${me.sub}`,
      displayName,
      metadata: { sub: me.sub },
    };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    if (!input.accessToken) {
      return { ok: false, notConfigured: true, error: "LinkedIn account not connected." };
    }

    // `externalId` is the author URN, e.g. "urn:li:person:xxxx" or "urn:li:organization:xxxx".
    const author = input.externalId;
    const text = composeText(input.body, input.hashtags);

    const res = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify({
        author,
        lifecycleState: "PUBLISHED",
        specificContent: {
          "com.linkedin.ugc.ShareContent": {
            shareCommentary: { text },
            shareMediaCategory: "NONE",
          },
        },
        visibility: { "com.linkedin.ugc.MemberNetworkVisibility": "PUBLIC" },
      }),
    });

    if (!res.ok) {
      return { ok: false, error: `LinkedIn publish failed (${res.status}): ${await res.text()}` };
    }
    const id = res.headers.get("x-restli-id") ?? undefined;
    return { ok: true, externalId: id };
  }
}
