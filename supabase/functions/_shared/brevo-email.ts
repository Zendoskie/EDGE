export const BREVO_API_KEY_ENV = "BREVO_API_KEY";
export const BREVO_FROM_ENV = "BREVO_FROM";
export const BREVO_API_URL = "https://api.brevo.com/v3/smtp/email";

export type BrevoEmailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export type BrevoSender = {
  name: string;
  email: string;
};

export type BrevoDeps = {
  getEnv: (key: string) => string | undefined;
  fetchFn: typeof fetch;
};

/**
 * Parse `EDGE <notify@example.com>` or a bare email into Brevo sender fields.
 * Preserves the configured display name when present.
 */
export function parseBrevoFromAddress(fromRaw: string): BrevoSender {
  const trimmed = fromRaw.trim();
  if (!trimmed) throw new Error(`${BREVO_FROM_ENV} is empty`);
  const match = trimmed.match(/^(.*)<(.+)>$/);
  if (match) {
    const name = match[1].trim();
    const email = match[2].trim();
    if (!email) throw new Error(`${BREVO_FROM_ENV} is invalid`);
    return { name: name || "EDGE", email };
  }
  return { name: "EDGE", email: trimmed };
}

export function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function createBrevoEmailSender(deps: BrevoDeps) {
  async function sendBrevoEmail(opts: BrevoEmailPayload): Promise<{ messageId?: string }> {
    const apiKey = deps.getEnv(BREVO_API_KEY_ENV);
    if (!apiKey?.trim()) {
      throw new Error(`Email not configured. Add ${BREVO_API_KEY_ENV} to Edge Function secrets.`);
    }
    const fromRaw = deps.getEnv(BREVO_FROM_ENV);
    if (!fromRaw?.trim()) {
      throw new Error(`Email not configured. Add ${BREVO_FROM_ENV} to Edge Function secrets.`);
    }
    const sender = parseBrevoFromAddress(fromRaw);
    const textContent = opts.text ?? htmlToPlainText(opts.html);

    const res = await deps.fetchFn(BREVO_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": apiKey.trim(),
      },
      body: JSON.stringify({
        sender,
        to: [{ email: opts.to }],
        subject: opts.subject,
        htmlContent: opts.html,
        textContent,
      }),
    });

    const result = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg =
        typeof result.message === "string"
          ? result.message
          : typeof result.error === "string"
            ? result.error
            : `Brevo error (${res.status})`;
      throw new Error(msg);
    }
    const messageId = typeof result.messageId === "string" ? result.messageId : undefined;
    return { messageId };
  }

  async function sendBrevoEmailBatch(emails: BrevoEmailPayload[]) {
    const results: { index: number; success: boolean; error?: string }[] = [];

    for (let i = 0; i < emails.length; i++) {
      const e = emails[i];
      try {
        await sendBrevoEmail(e);
        results.push({ index: i, success: true });
      } catch (err) {
        results.push({
          index: i,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const data = results
      .filter((r) => r.success)
      .map(() => ({ id: crypto.randomUUID ? crypto.randomUUID() : "" }));
    const errors = results
      .filter((r) => !r.success)
      .map((r) => ({ index: r.index, message: r.error || "Unknown error" }));
    const sent = results.filter((r) => r.success).length;

    return { data, errors, sent, failed: errors.length };
  }

  return { sendBrevoEmail, sendBrevoEmailBatch };
}

function edgeGetEnv(key: string): string | undefined {
  if (typeof Deno === "undefined") return undefined;
  return Deno.env.get(key);
}

const defaultSender = createBrevoEmailSender({
  getEnv: edgeGetEnv,
  fetchFn: fetch,
});

export const sendBrevoEmail = defaultSender.sendBrevoEmail;
export const sendBrevoEmailBatch = defaultSender.sendBrevoEmailBatch;

export type SendAppEmail = typeof sendBrevoEmail;
