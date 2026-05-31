import type { Platform } from "@/core/types";
import {
  composeText,
  type AccountIdentity,
  type OAuthExchangeInput,
  type OAuthStartInput,
  type OAuthTokens,
  type Publisher,
  type PublishInput,
  type PublishResult,
} from "./publisher";

const GRAPH = "https://graph.facebook.com/v21.0";

/** A Page the connecting user manages, with its (long-lived) Page access token. */
export interface ManagedPage {
  id: string;
  name: string;
  access_token: string;
  instagram_business_account?: { id: string; username?: string };
}

/**
 * Facebook Page publisher (Graph API).
 *
 * Token model: the OAuth code exchange returns a short-lived *user* token, which
 * we immediately upgrade to a long-lived user token. Posting to a Page, though,
 * requires the *Page* access token — discovered via `/me/accounts` during
 * identity resolution. Page tokens minted from a long-lived user token do not
 * expire, so once connected the integration keeps working without refresh.
 *
 * Requirements: a Meta app with `pages_manage_posts` + `pages_read_engagement`,
 * App Review approval.
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
    // 1) Code -> short-lived user token (Meta uses a GET endpoint).
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
    const shortLived = String(raw.access_token ?? "");

    // 2) Upgrade to a long-lived user token (~60 days).
    const longLived = await this.exchangeForLongLivedToken(
      shortLived,
      input.clientId,
      input.clientSecret,
    );

    return longLived ?? fallbackTokens(raw, shortLived);
  }

  private async exchangeForLongLivedToken(
    shortLivedToken: string,
    clientId: string,
    clientSecret: string,
  ): Promise<OAuthTokens | null> {
    const url = new URL(`${GRAPH}/oauth/access_token`);
    url.searchParams.set("grant_type", "fb_exchange_token");
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("client_secret", clientSecret);
    url.searchParams.set("fb_exchange_token", shortLivedToken);

    const res = await fetch(url.toString());
    const raw = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      // Non-fatal: fall back to the short-lived token.
      console.warn(`Meta long-lived exchange failed (${res.status}): ${JSON.stringify(raw)}`);
      return null;
    }
    const expiresIn = typeof raw.expires_in === "number" ? raw.expires_in : undefined;
    return {
      accessToken: String(raw.access_token ?? shortLivedToken),
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
      raw,
    };
  }

  /** List the Pages the user manages, including Page tokens and any linked IG account. */
  async listManagedPages(userToken: string): Promise<ManagedPage[]> {
    const url = new URL(`${GRAPH}/me/accounts`);
    url.searchParams.set(
      "fields",
      "id,name,access_token,instagram_business_account{id,username}",
    );
    url.searchParams.set("access_token", userToken);

    const res = await fetch(url.toString());
    const data = (await res.json()) as { data?: ManagedPage[]; error?: unknown };
    if (!res.ok) {
      throw new Error(`Meta /me/accounts failed (${res.status}): ${JSON.stringify(data)}`);
    }
    return data.data ?? [];
  }

  async fetchIdentity(accessToken: string): Promise<AccountIdentity> {
    const pages = await this.listManagedPages(accessToken);
    const page = pickPage(pages);
    if (!page) {
      throw new Error(
        "No Facebook Pages found for this user. Connect an account that manages a Page.",
      );
    }
    return {
      externalId: page.id,
      displayName: page.name,
      // Store the Page token (not the user token) — that's what we publish with.
      accessToken: page.access_token,
      metadata: { pageId: page.id },
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

/** Choose which Page to use: the one named by META_PAGE_ID, else the first. */
export function pickPage(pages: ManagedPage[]): ManagedPage | undefined {
  const preferred = process.env.META_PAGE_ID;
  if (preferred) {
    const match = pages.find((p) => p.id === preferred);
    if (match) return match;
  }
  return pages[0];
}

function fallbackTokens(raw: Record<string, unknown>, accessToken: string): OAuthTokens {
  const expiresIn = typeof raw.expires_in === "number" ? raw.expires_in : undefined;
  return {
    accessToken,
    expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : undefined,
    raw,
  };
}
