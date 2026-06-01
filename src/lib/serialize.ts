/**
 * SQLite (de)serialization bridge for the desktop build.
 *
 * SQLite — unlike PostgreSQL — has no native scalar-list type and no enum type
 * (see prisma/schema.sqlite.prisma). To keep the rest of the app working with
 * the same domain shapes it always used, we:
 *
 *   * store `string[]` columns (tags / hashtags / mediaUrls) as a single JSON
 *     string, and pack/unpack them at the database boundary; and
 *   * store enum columns (platform / status / autonomy) as plain strings,
 *     re-narrowing them to the canonical unions from src/core/types.ts on read.
 *
 * These helpers are deliberately tolerant: `unpackList` accepts a value that is
 * already an array (the PostgreSQL shape), so the same code path keeps working
 * if the schema is ever pointed back at Postgres.
 */
import type { AutonomyLevel, Platform, PostStatus } from "@/core/types";

/** Encode a string[] for storage in a SQLite TEXT column. */
export function packList(values: readonly string[] | null | undefined): string {
  return JSON.stringify(values ? [...values] : []);
}

/**
 * Decode a JSON-encoded string[] coming out of SQLite. Tolerant of:
 *   - a real array (Postgres / already-parsed) -> returned as string[]
 *   - a JSON string "[...]"                     -> parsed
 *   - null / undefined / "" / malformed         -> []
 */
export function unpackList(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map((v) => String(v));
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((v) => String(v)) : [];
  } catch {
    // Fall back to treating a bare/legacy value as a single-element list.
    return [raw];
  }
}

/**
 * Narrow a SQLite TEXT value to the Platform union. Values originate from our
 * own writes (always one of PLATFORMS), so this is a safe, centralized cast.
 * Accepts the Prisma enum type too, so it is a no-op under Postgres.
 */
export function asPlatform(value: string): Platform {
  return value as Platform;
}

/** Narrow a SQLite TEXT value to the PostStatus union (see asPlatform). */
export function asPostStatus(value: string): PostStatus {
  return value as PostStatus;
}

/** Narrow a SQLite TEXT value to the AutonomyLevel union (see asPlatform). */
export function asAutonomy(value: string): AutonomyLevel {
  return value as AutonomyLevel;
}
