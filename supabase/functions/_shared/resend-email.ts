export const RESEND_API_KEY_ENV = "RESEND_API_KEY";
export const RESEND_FROM_ENV = "RESEND_FROM";
export const RESEND_API_URL = "https://api.resend.com/emails";

export type ResendEmailPayload = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export type ResendDeps = {
  getEnv: (key: string) => string | undefined;
  fetchFn: typeof fetch;
};

/** Format `Name <email@domain>` or a bare email for Resend's `from` field. */
export function formatResendFromAddress(fromRaw: string): string {
  const trimmed = fromRaw.trim();
  if (!trimmed) throw new Error(`${RESEND_FROM_ENV} is empty`);
  const match = trimmed.match(/^(.*)<(.+)>$/);
  if (match) {
    const name = match[1].trim();
    const email = match[2].trim();
    return name ? `${name} <${email}>` : email;
  }
  return trimmed;
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

export function createResendEmailSender(deps: ResendDeps) {
  async function sendResendEmail(opts: ResendEmailPayload): Promise<{ id?: string }> {
    const apiKey = deps.getEnv(RESEND_API_KEY_ENV);
    if (!apiKey?.trim()) {
      throw new Error(`Email not configured. Add ${RESEND_API_KEY_ENV} to Edge Function secrets.`);
    }
    const fromRaw = deps.getEnv(RESEND_FROM_ENV);
    if (!fromRaw?.trim()) {
      throw new Error(`Email not configured. Add ${RESEND_FROM_ENV} to Edge Function secrets.`);
    }
    const from = formatResendFromAddress(fromRaw);
    const text = opts.text ?? htmlToPlainText(opts.html);

    const res = await deps.fetchFn(RESEND_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey.trim()}`,
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text,
      }),
    });

    const result = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const msg =
        typeof result.message === "string"
          ? result.message
          : typeof result.error === "string"
            ? result.error
            : `Resend error (${res.status})`;
      throw new Error(msg);
    }
    const id = typeof result.id === "string" ? result.id : undefined;
    return { id };
  }

  async function sendResendEmailBatch(emails: ResendEmailPayload[]) {
    const results: { index: number; success: boolean; error?: string }[] = [];

    for (let i = 0; i < emails.length; i++) {
      const e = emails[i];
      try {
        await sendResendEmail(e);
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

  return { sendResendEmail, sendResendEmailBatch };
}

function edgeGetEnv(key: string): string | undefined {
  if (typeof Deno === "undefined") return undefined;
  return Deno.env.get(key);
}

const defaultSender = createResendEmailSender({
  getEnv: edgeGetEnv,
  fetchFn: fetch,
});

export const sendResendEmail = defaultSender.sendResendEmail;
export const sendResendEmailBatch = defaultSender.sendResendEmailBatch;

export type SendAppEmail = typeof sendResendEmail;
