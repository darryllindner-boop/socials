/**
 * Compute a timezone's current UTC offset (in minutes) using the built-in Intl
 * APIs — no date library required. Returns `local - UTC`, so Oslo in summer
 * (CEST) yields +120. Used to feed the dependency-free scheduling planner the
 * correct offset for the brand's IANA timezone.
 */
export function tzOffsetMinutes(timeZone: string, at: Date = new Date()): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(at);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  const asUTC = Date.UTC(
    map.year!,
    (map.month ?? 1) - 1,
    map.day!,
    map.hour ?? 0,
    map.minute ?? 0,
    map.second ?? 0,
  );
  return Math.round((asUTC - at.getTime()) / 60_000);
}

/** Parse a comma/space separated list of hours from env, with a default. */
export function parseSlotHours(raw: string | undefined, fallback: number[]): number[] {
  if (!raw) return fallback;
  const hours = raw
    .split(/[,\s]+/)
    .map((s) => Number(s))
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 23);
  return hours.length > 0 ? hours : fallback;
}
