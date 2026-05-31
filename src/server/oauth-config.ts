import type { Platform } from "@/core/types";

export interface OAuthAppConfig {
  clientId: string;
  clientSecret: string;
}

/**
 * Resolve the OAuth app credentials for a platform from env. Facebook and
 * Instagram share one Meta app. Returns null when credentials are not yet set,
 * so the UI can show "configure this app" instead of a broken connect button.
 */
export function getOAuthAppConfig(platform: Platform): OAuthAppConfig | null {
  const pick = (id?: string, secret?: string): OAuthAppConfig | null =>
    id && secret ? { clientId: id, clientSecret: secret } : null;

  switch (platform) {
    case "linkedin":
      return pick(process.env.LINKEDIN_CLIENT_ID, process.env.LINKEDIN_CLIENT_SECRET);
    case "facebook":
    case "instagram":
      return pick(process.env.META_APP_ID, process.env.META_APP_SECRET);
    case "x":
      return pick(process.env.X_CLIENT_ID, process.env.X_CLIENT_SECRET);
    default:
      return null;
  }
}

export function redirectUriFor(platform: Platform): string {
  const base = process.env.APP_BASE_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/oauth/${platform}/callback`;
}
