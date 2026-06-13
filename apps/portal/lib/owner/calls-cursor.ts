export type CallCursor = { at: string; id: string };

// "<created_at>~<id>" — created_at is an ISO timestamp (contains no '~'); id is a uuid.
export function encodeCursor(row: { created_at: string; id: string }): string {
  return `${row.created_at}~${row.id}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function decodeCursor(raw: string | undefined | null): CallCursor | null {
  if (!raw) return null;
  const i = raw.indexOf("~");
  if (i <= 0 || i === raw.length - 1) return null;
  const at = raw.slice(0, i);
  const id = raw.slice(i + 1);
  // Defense in depth: a hand-crafted ?before= must not be able to shape the
  // PostgREST .or() filter. Reject structural chars in `at` and require a uuid
  // `id`, so the decoded parts can only be a real cursor. (RLS already scopes
  // results and supabase-js URL-encodes the filter; this removes the question
  // without asserting the timestamp's exact serialization.) Also rejects a stray
  // second '~' (the id would fail the uuid check).
  if (/[,()]/.test(at)) return null;
  if (!UUID_RE.test(id)) return null;
  return { at, id };
}

// PostgREST .or() expressing "strictly older than (at, id)" under (created_at desc, id desc).
// The ISO timestamp contains ':'/'.'/T/Z but no ','/'/''(' so it parses as a bare PostgREST
// filter value without escaping — supabase-js URL-encodes the full .or() string for us.
export function keysetOrFilter(c: CallCursor): string {
  return `created_at.lt.${c.at},and(created_at.eq.${c.at},id.lt.${c.id})`;
}
