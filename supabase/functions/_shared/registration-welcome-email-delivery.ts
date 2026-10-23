/** Claim outcomes from `try_claim_registration_welcome_email` (mirrored in tests). */
export type RegistrationWelcomeClaimOutcome = "claimed" | "duplicate" | "in_flight";

export type RegistrationWelcomeDeliveryResult = "sent" | "duplicate" | "failed";

/**
 * Orchestrates claim → provider send → mark sent/failed without holding a DB transaction across the network call.
 */
export async function deliverRegistrationWelcomeEmail(opts: {
  claim: () => Promise<RegistrationWelcomeClaimOutcome>;
  send: () => Promise<void>;
  markSent: () => Promise<void>;
  markFailed: () => Promise<void>;
  afterSent?: () => Promise<void>;
}): Promise<RegistrationWelcomeDeliveryResult> {
  const claim = await opts.claim();
  if (claim === "duplicate" || claim === "in_flight") {
    return "duplicate";
  }

  try {
    await opts.send();
  } catch {
    try {
      await opts.markFailed();
    } catch {
      /* best effort; claim may remain until stale reclaim */
    }
    return "failed";
  }

  try {
    await opts.markSent();
  } catch {
    /* Provider accepted the message; do not send again on this claim. */
    return "sent";
  }

  if (opts.afterSent) {
    try {
      await opts.afterSent();
    } catch {
      /* audit log only */
    }
  }

  return "sent";
}

export const REGISTRATION_WELCOME_STALE_CLAIM_MINUTES = 15;

export type WelcomeEmailClaimRow = {
  delivery_status: "claimed" | "sent" | "failed";
  claimed_at: string;
};

/**
 * In-memory claim store matching migration `try_claim_registration_welcome_email` semantics (for tests).
 */
export class InMemoryRegistrationWelcomeClaimStore {
  private rows = new Map<string, WelcomeEmailClaimRow>();

  private key(requestId: string, dedupeKey: string): string {
    return `${requestId}\0${dedupeKey}`;
  }

  tryClaim(requestId: string, dedupeKey: string, now = Date.now()): RegistrationWelcomeClaimOutcome {
    const k = this.key(requestId, dedupeKey);
    if (!this.rows.has(k)) {
      this.rows.set(k, {
        delivery_status: "claimed",
        claimed_at: new Date(now).toISOString(),
      });
      return "claimed";
    }

    const row = this.rows.get(k)!;
    if (row.delivery_status === "sent") return "duplicate";
    if (row.delivery_status === "failed") {
      row.delivery_status = "claimed";
      row.claimed_at = new Date(now).toISOString();
      return "claimed";
    }

    const claimedAt = Date.parse(row.claimed_at);
    const staleMs = REGISTRATION_WELCOME_STALE_CLAIM_MINUTES * 60 * 1000;
    if (Number.isFinite(claimedAt) && now - claimedAt > staleMs) {
      row.claimed_at = new Date(now).toISOString();
      return "claimed";
    }

    return "in_flight";
  }

  markSent(requestId: string, dedupeKey: string): boolean {
    const k = this.key(requestId, dedupeKey);
    const row = this.rows.get(k);
    if (!row || row.delivery_status !== "claimed") return false;
    row.delivery_status = "sent";
    return true;
  }

  markFailed(requestId: string, dedupeKey: string): boolean {
    const k = this.key(requestId, dedupeKey);
    const row = this.rows.get(k);
    if (!row || row.delivery_status !== "claimed") return false;
    row.delivery_status = "failed";
    return true;
  }

  getStatus(requestId: string, dedupeKey: string): WelcomeEmailClaimRow["delivery_status"] | null {
    return this.rows.get(this.key(requestId, dedupeKey))?.delivery_status ?? null;
  }
}
