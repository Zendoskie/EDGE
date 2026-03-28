/**
 * Normalizes LLM output for UI: removes markdown (**, *, > quotes), normalizes
 * bullets, and tightens extra blank lines. No asterisk characters remain in output.
 */

/** Unicode characters sometimes used by models instead of ASCII * */
const ASTERISK_LIKE = /[\u2217\uFF0A\u204E\u066D]/g;

export function sanitizeAssistantPlainText(raw: string): string {
  if (!raw) return "";
  let s = raw.replace(/\r\n/g, "\n").trim();

  s = s.replace(ASTERISK_LIKE, "*");

  // Bold / strong — remove delimiter pairs (handles odd counts via repeat passes)
  let prev = "";
  while (prev !== s) {
    prev = s;
    s = s.replace(/\*\*/g, "");
  }

  // Blockquote markers
  s = s.replace(/^\s*>\s?/gm, "");

  // Line-start bullets (single * or -) before final asterisk purge
  s = s.replace(/^\s*\*\s+/gm, "• ");
  s = s.replace(/^\s*-\s+/gm, "• ");

  // Any remaining * (italic markers, stray emphasis)
  s = s.replace(/\*/g, "");

  // Markdown __bold__ markers (pairs of underscores)
  s = s.replace(/__+/g, "");

  s = s.replace(/\n{3,}/g, "\n\n");
  return s.trim();
}
