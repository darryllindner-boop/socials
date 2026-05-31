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
import { FacebookPublisher } from "./facebook";

const GRAPH = "https://graph.facebook.com/v21.0";

/**
 * Instagram publisher (Instagram Graph API via a connected Facebook Page).
 *
 * Requirements: an IG Business/Creator account linked to a Facebook Page, a
 * Meta app with `instagram_content_publish` (App Review required).
 *
 * IMPORTANT: Instagram has no text-only posts. Publishing is a two-step flow
 * (create media container -> publish), so `mediaUrls[0]` is required. Until the
 * media pipeline (Phase 2) is wired, text-only variants surface a clear,
 * non-destructive error rather than a fake success.
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

  async publish(input: PublishInput): Promise<PublishResult> {
    if (!input.accessToken) {
      return { ok: false, notConfigured: true, error: "Instagram account not connected." };
    }
    const imageUrl = input.mediaUrls?.[0];
    if (!imageUrl) {
      return {
        ok: false,
        notConfigured: true,
        error: "Instagram requires an image/video. Attach media (Phase 2) before publishing.",
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
