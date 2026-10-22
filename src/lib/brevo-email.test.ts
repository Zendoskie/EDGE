import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  BREVO_API_KEY_ENV,
  BREVO_API_URL,
  BREVO_FROM_ENV,
  createBrevoEmailSender,
  parseBrevoFromAddress,
} from '../../supabase/functions/_shared/brevo-email';

describe('brevo email delivery', () => {
  const fetchFn = vi.fn();
  const getEnv = vi.fn();

  beforeEach(() => {
    fetchFn.mockReset();
    getEnv.mockReset();
  });

  it('parses sender name and email from BREVO_FROM', () => {
    expect(parseBrevoFromAddress('EDGE <modsmoderator123@gmail.com>')).toEqual({
      name: 'EDGE',
      email: 'modsmoderator123@gmail.com',
    });
    expect(parseBrevoFromAddress('notify@example.com')).toEqual({
      name: 'EDGE',
      email: 'notify@example.com',
    });
  });

  it('sends a successful Brevo API request with expected payload', async () => {
    getEnv.mockImplementation((key: string) => {
      if (key === BREVO_API_KEY_ENV) return 'xkeysib-test';
      if (key === BREVO_FROM_ENV) return 'EDGE <modsmoderator123@gmail.com>';
      return undefined;
    });
    fetchFn.mockResolvedValue({
      ok: true,
      json: async () => ({ messageId: '<msg-1>' }),
    });

    const { sendBrevoEmail } = createBrevoEmailSender({ getEnv, fetchFn });
    const result = await sendBrevoEmail({
      to: 'student@example.com',
      subject: 'Test',
      html: '<p>Hello</p>',
    });

    expect(result.messageId).toBe('<msg-1>');
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(BREVO_API_URL);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers['api-key']).toBe('xkeysib-test');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(init.body as string);
    expect(body.sender).toEqual({ name: 'EDGE', email: 'modsmoderator123@gmail.com' });
    expect(body.to).toEqual([{ email: 'student@example.com' }]);
    expect(body.subject).toBe('Test');
    expect(body.htmlContent).toBe('<p>Hello</p>');
    expect(body.textContent).toContain('Hello');
  });

  it('requires BREVO_API_KEY and BREVO_FROM', async () => {
    const { sendBrevoEmail } = createBrevoEmailSender({ getEnv, fetchFn });
    await expect(
      sendBrevoEmail({ to: 'a@b.com', subject: 's', html: '<p>x</p>' }),
    ).rejects.toThrow(BREVO_API_KEY_ENV);

    getEnv.mockImplementation((key) => (key === BREVO_API_KEY_ENV ? 'xkeysib-test' : undefined));
    await expect(
      sendBrevoEmail({ to: 'a@b.com', subject: 's', html: '<p>x</p>' }),
    ).rejects.toThrow(BREVO_FROM_ENV);
  });

  it('surfaces Brevo HTTP errors without leaking secrets', async () => {
    getEnv.mockImplementation((key: string) => {
      if (key === BREVO_API_KEY_ENV) return 'xkeysib-test';
      if (key === BREVO_FROM_ENV) return 'notify@example.com';
      return undefined;
    });
    fetchFn.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'Key not found' }),
    });

    const { sendBrevoEmail } = createBrevoEmailSender({ getEnv, fetchFn });
    const err = await sendBrevoEmail({ to: 'student@example.com', subject: 's', html: '<p>x</p>' }).catch(
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe('Key not found');
    expect((err as Error).message).not.toContain('xkeysib');
  });

  it('reports per-recipient batch failures', async () => {
    getEnv.mockImplementation((key: string) => {
      if (key === BREVO_API_KEY_ENV) return 'xkeysib-test';
      if (key === BREVO_FROM_ENV) return 'notify@example.com';
      return undefined;
    });
    fetchFn
      .mockResolvedValueOnce({ ok: true, json: async () => ({ messageId: 'a' }) })
      .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ message: 'invalid' }) });

    const { sendBrevoEmailBatch } = createBrevoEmailSender({ getEnv, fetchFn });
    const batch = await sendBrevoEmailBatch([
      { to: 'a@example.com', subject: 's', html: '<p>1</p>' },
      { to: 'b@example.com', subject: 's', html: '<p>2</p>' },
    ]);
    expect(batch.sent).toBe(1);
    expect(batch.failed).toBe(1);
    expect(batch.errors).toEqual([{ index: 1, message: 'invalid' }]);
  });
});
