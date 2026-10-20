import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  deliverRegistrationWelcomeEmail,
  InMemoryRegistrationWelcomeClaimStore,
  REGISTRATION_WELCOME_STALE_CLAIM_MINUTES,
} from '../../supabase/functions/_shared/registration-welcome-email-delivery.ts';

const root = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

describe('registration welcome email delivery orchestration', () => {
  const requestId = 'req-1';
  const dedupeKey = 'parent_registration_decision:req-1:registration_access_activated:ts';

  function storeBackedDelivery(store: InMemoryRegistrationWelcomeClaimStore, send: () => Promise<void>) {
    return deliverRegistrationWelcomeEmail({
      claim: async () => store.tryClaim(requestId, dedupeKey),
      send,
      markSent: async () => {
        if (!store.markSent(requestId, dedupeKey)) throw new Error('markSent failed');
      },
      markFailed: async () => {
        store.markFailed(requestId, dedupeKey);
      },
    });
  }

  it('sends once and marks sent on success', async () => {
    const store = new InMemoryRegistrationWelcomeClaimStore();
    const send = vi.fn().mockResolvedValue(undefined);

    const result = await storeBackedDelivery(store, send);
    expect(result).toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
    expect(store.getStatus(requestId, dedupeKey)).toBe('sent');
  });

  it('does not send again after successful delivery', async () => {
    const store = new InMemoryRegistrationWelcomeClaimStore();
    const send = vi.fn().mockResolvedValue(undefined);

    await storeBackedDelivery(store, send);
    const second = await storeBackedDelivery(store, send);

    expect(second).toBe('duplicate');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate sends under concurrent claims', async () => {
    const store = new InMemoryRegistrationWelcomeClaimStore();
    let inFlight = 0;
    let maxInFlight = 0;
    const send = vi.fn().mockImplementation(async () => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 25));
      inFlight -= 1;
    });

    const results = await Promise.all([
      storeBackedDelivery(store, send),
      storeBackedDelivery(store, send),
      storeBackedDelivery(store, send),
    ]);

    expect(send).toHaveBeenCalledTimes(1);
    expect(maxInFlight).toBe(1);
    expect(results.filter((r) => r === 'sent')).toHaveLength(1);
    expect(results.filter((r) => r === 'duplicate')).toHaveLength(2);
  });

  it('does not mark sent when the provider fails and allows retry', async () => {
    const store = new InMemoryRegistrationWelcomeClaimStore();
    const sendFail = vi.fn().mockRejectedValue(new Error('brevo down'));

    const failed = await storeBackedDelivery(store, sendFail);
    expect(failed).toBe('failed');
    expect(store.getStatus(requestId, dedupeKey)).toBe('failed');

    const sendOk = vi.fn().mockResolvedValue(undefined);
    const retry = await storeBackedDelivery(store, sendOk);
    expect(retry).toBe('sent');
    expect(sendOk).toHaveBeenCalledTimes(1);
  });

  it('treats in-flight claims as duplicate without sending', async () => {
    const store = new InMemoryRegistrationWelcomeClaimStore();
    store.tryClaim(requestId, dedupeKey);
    const send = vi.fn();

    const result = await storeBackedDelivery(store, send);
    expect(result).toBe('duplicate');
    expect(send).not.toHaveBeenCalled();
  });

  it('reclaims stale claimed rows after the stale window', async () => {
    const store = new InMemoryRegistrationWelcomeClaimStore();
    const staleMs = (REGISTRATION_WELCOME_STALE_CLAIM_MINUTES + 1) * 60 * 1000;
    const past = Date.now() - staleMs;
    store.tryClaim(requestId, dedupeKey, past);

    const send = vi.fn().mockResolvedValue(undefined);
    const result = await storeBackedDelivery(store, send);
    expect(result).toBe('sent');
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('registration welcome idempotency migration contract', () => {
  it('defines a primary key claim table and service-role RPCs', () => {
    const sql = read('supabase/migrations/20261020150300_registration_welcome_email_idempotency.sql');
    expect(sql).toContain('registration_welcome_email_deliveries');
    expect(sql).toContain('PRIMARY KEY (parent_registration_request_id, dedupe_key)');
    expect(sql).toContain('try_claim_registration_welcome_email');
    expect(sql).toContain('complete_registration_welcome_email');
    expect(sql).toContain('fail_registration_welcome_email');
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.try_claim_registration_welcome_email");
    expect(sql).toContain('TO service_role');
  });
});

describe('send-parent-email handler wiring', () => {
  it('loads invitation role and request status before welcome delivery', () => {
    const edge = read('supabase/functions/send-parent-email/index.ts');
    expect(edge).toContain('.select("id, email, status, role, parent_request_id, accepted_at")');
    expect(edge).toContain('validateRegistrationWelcomeEligibility');
    expect(edge).toContain('try_claim_registration_welcome_email');
    expect(edge).toContain('deliverRegistrationWelcomeEmail');
    const welcomeFn = edge.slice(
      edge.indexOf('async function handleRegistrationAccessActivated'),
      edge.indexOf('serve(async (req)'),
    );
    expect(welcomeFn).toContain('deliverRegistrationWelcomeEmail');
    expect(welcomeFn).not.toContain('deliverEmail({');
  });
});
