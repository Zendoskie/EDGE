/** Existing durable-inbox backup interval. Do not tighten this. */
export const DURABLE_INBOX_POLL_MS = 180_000;

/** One delayed retry after a failed inbox read. Not a polling loop. */
export const DURABLE_INBOX_RETRY_MS = 8_000;
export const DURABLE_INBOX_MAX_RETRIES = 1;

export type DurableInboxRow = {
  id: string;
  title: string;
  body: string;
  source_name?: string | null;
};

export type DurableInboxInput = {
  title: string;
  body: string;
  sourceName: string;
  dedupeKey: string;
  serverId: string;
};

export function durableInboxRetryDelay(attempt: number): number | null {
  if (attempt < DURABLE_INBOX_MAX_RETRIES) return DURABLE_INBOX_RETRY_MS;
  return null;
}

/** A caller can read an inbox row only when they are the stored recipient. */
export function canReadInboxRow(rowUserId: string, callerId: string): boolean {
  return rowUserId === callerId;
}

export function durableRowToInboxInput(row: DurableInboxRow): DurableInboxInput | null {
  const id = row.id?.trim();
  const title = row.title?.trim();
  const body = row.body?.trim();
  if (!id || !title || !body) return null;
  return {
    title,
    body,
    sourceName: row.source_name?.trim() || "EDGE System",
    dedupeKey: `user-inbox-notification:${id}`,
    serverId: id,
  };
}

export function readServerIdsToSync(
  items: Array<{ read: boolean; serverId?: string }>,
  alreadySynced: ReadonlySet<string>,
): string[] {
  const ids: string[] = [];
  for (const item of items) {
    if (!item.read || !item.serverId || alreadySynced.has(item.serverId)) continue;
    ids.push(item.serverId);
  }
  return ids;
}

/** Pending ids the viewer has not already been told about. The first observation is included. */
export function idsToAnnounce(seen: ReadonlySet<string>, currentIds: string[]): string[] {
  const announced: string[] = [];
  const batch = new Set<string>();
  for (const id of currentIds) {
    if (!id || seen.has(id) || batch.has(id)) continue;
    batch.add(id);
    announced.push(id);
  }
  return announced;
}
