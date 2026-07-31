/**
 * Pure helpers for normalizing and comparing parent email addresses.
 * Kept framework-free so they can be unit tested and reused by both the
 * SQL-backed RPC error mapping and the email edge function client.
 */

export function normalizeEmailForCompare(email: string | null | undefined): string {
  if (!email) return "";
  return email.trim().toLowerCase();
}

export function parentEmailsMatch(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return normalizeEmailForCompare(a) === normalizeEmailForCompare(b);
}

export function hasParentEmail(email: string | null | undefined): boolean {
  return normalizeEmailForCompare(email).length > 0;
}
