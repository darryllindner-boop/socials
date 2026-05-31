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
import { FacebookPublisher, pickPage } from "./facebook";

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Instagram publisher (Instagram Graph API via a connected Facebook Page).
 *
 * Requirements: an IG Business/Creator account linked to a Facebook Page, a
 * Meta app with `instagram_content_publish` (App Review required).
 *
 * IMPORTANT: Instagram has no text-only posts. Publishing is a two-step flow
 * (create media container -> publish), so `mediaUrls[0]` is required. Variants
 * without media surface a clear, non-destructive error rather than a fake
 * success — attach an image URL on the variant in the review queue first.
 */
export class InstagramPublisher implements Publisher {
  readonly platform: Platform = "instagram";
  readonly scopes = [
    "instagram_basic",
    "instagram_content_publish",
    "pages_show_list",
    "pages_read_engagement",
  ];
  readonly requirements =
    "IG Business/Creator account linked to a Facebook Page + Meta app with instagram_content_publish (App Review). Requires an image/video — no text-only posts.";

  private readonly fb = new FacebookPublisher();

  // Instagram uses the same Meta OAuth flow as Facebook.
  authorizationUrl(input: OAuthStartInput): string {
    return this.fb.authorizationUrl(input);
  }

  exchangeCode(input: OAuthExchangeInput): Promise<OAuthTokens> {
    return this.fb.exchangeCode(input);
  }

  /**
   * Find the IG Business/Creator account linked to one of the user's Pages.
   * Publishing uses the *Page* access token, and `externalId` is the IG user id.
   */
  async fetchIdentity(accessToken: string): Promise<AccountIdentity> {
    const pages = await this.fb.listManagedPages(accessToken);
    const withIg = pages.filter((p) => p.instagram_business_account?.id);
    if (withIg.length === 0) {
      throw new Error(
        "No Instagram Business account linked to your Pages. Link an IG Business/Creator account to a Facebook Page in Meta settings.",
      );
    }
    // Honour META_PAGE_ID if it points at an IG-linked page; else first IG-linked page.
    const page = pickPage(withIg) ?? withIg[0]!;
    const ig = page.instagram_business_account!;
    return {
      externalId: ig.id,
      displayName: ig.username ? `@${ig.username}` : "Instagram account",
      // Publish with the Page token; it authorises the linked IG account too.
      accessToken: page.access_token,
      metadata: { pageId: page.id, igUserId: ig.id, username: ig.username },
    };
  }

  async publish(input: PublishInput): Promise<PublishResult> {
    if (!input.accessToken) {
      return { ok: false, notConfigured: true, error: "Instagram account not connected." };
    }
    const imageUrl = input.mediaUrls?.[0];
    if (!imageUrl) {
      return {
        ok: false,
        notConfigured: true,
        error: "Instagram requires an image/video. Attach an image URL on the variant before publishing.",
      };
    }

    const caption = composeText(input.body, input.hashtags);
    const igUserId = input.externalId;

    // Step 1: create media container.
    const createUrl = new URL(`${GRAPH}/${igUserId}/media`);
    createUrl.searchParams.set("image_url", imageUrl);
    createUrl.searchParams.set("caption", caption);
    createUrl.searchParams.set("access_token", input.accessToken);
    const createRes = await fetch(createUrl.toString(), { method: "POST" });
    const createData = (await createRes.json()) as { id?: string };
    if (!createRes.ok || !createData.id) {
      return {
        ok: false,
        error: `Instagram container failed (${createRes.status}): ${JSON.stringify(createData)}`,
      };
    }

    // Step 2: publish the container.
    const pubUrl = new URL(`${GRAPH}/${igUserId}/media_publish`);
    pubUrl.searchParams.set("creation_id", createData.id);
    pubUrl.searchParams.set("access_token", input.accessToken);
    const pubRes = await fetch(pubUrl.toString(), { method: "POST" });
    const pubData = (await pubRes.json()) as { id?: string };
    if (!pubRes.ok) {
      return {
        ok: false,
        error: `Instagram publish failed (${pubRes.status}): ${JSON.stringify(pubData)}`,
      };
    }
    return { ok: true, externalId: pubData.id };
  }
}
