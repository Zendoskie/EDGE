import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RESEND_API_KEY_ENV,
  RESEND_API_URL,
  RESEND_FROM_ENV,
  createResendEmailSender,
  formatResendFromAddress,
  htmlToPlainText,
} from '../../supabase/functions/_shared/resend-email';

describe('resend email delivery', () => {
  const fetchFn = vi.fn();
  const getEnv = vi.fn<(key: string) => string | undefined>();

  beforeEach(() => {
    fetchFn.mockReset();
    getEnv.mockReset();
  });

  it('formats from addresses for Resend', () => {
    expect(formatResendFromAddress('EDGE <notify@example.com>')).toBe('EDGE <notify@example.com>');
    expect(formatResendFromAddress('notify@example.com')).toBe('notify@example.com');
  });

  it('derives plain text from HTML when text is omitted', () => {
    const text = htmlToPlainText('<p>Hello <strong>world</strong></p><p>Line two</p>');
    expect(text).toContain('Hello world');
    expect(text).toContain('Line two');
  });

  it('sends a successful Resend API request with expected payload', async () => {
    getEnv.mockImplementation((key) => {
      if (key === RESEND_API_KEY_ENV) return 're_test_key';
      if (key === RESEND_FROM_ENV) return 'EDGE <notify@example.com>';
      return undefined;
    });
    fetchFn.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ id: 'email_123' }),
    });

    const { sendResendEmail } = createResendEmailSender({ getEnv, fetchFn });
    const result = await sendResendEmail({
      to: 'student@example.com',
      subject: 'EDGE: Test',
      html: '<p>Hi</p>',
    });

    expect(result.id).toBe('email_123');
    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, init] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RESEND_API_URL);
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_test_key');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(String(init.body));
    expect(body.from).toBe('EDGE <notify@example.com>');
    expect(body.to).toEqual(['student@example.com']);
    expect(body.subject).toBe('EDGE: Test');
    expect(body.html).toBe('<p>Hi</p>');
    expect(body.text).toContain('Hi');
    expect(JSON.stringify(body)).not.toContain('re_test_key');
  });

  it('throws when API key or sender is missing', async () => {
    getEnv.mockReturnValue(undefined);
    const { sendResendEmail } = createResendEmailSender({ getEnv, fetchFn });
    await expect(
      sendResendEmail({ to: 'a@b.com', subject: 's', html: '<p>x</p>' }),
    ).rejects.toThrow(RESEND_API_KEY_ENV);

    getEnv.mockImplementation((key) => (key === RESEND_API_KEY_ENV ? 're_test_key' : undefined));
    await expect(
      sendResendEmail({ to: 'a@b.com', subject: 's', html: '<p>x</p>' }),
    ).rejects.toThrow(RESEND_FROM_ENV);
  });

  it('surfaces Resend HTTP errors without leaking secrets', async () => {
    getEnv.mockImplementation((key) => {
      if (key === RESEND_API_KEY_ENV) return 're_test_key';
      if (key === RESEND_FROM_ENV) return 'notify@example.com';
      return undefined;
    });
    fetchFn.mockResolvedValue({
      ok: false,
      status: 422,
      json: async () => ({ message: 'Invalid from address' }),
    });

    const { sendResendEmail } = createResendEmailSender({ getEnv, fetchFn });
    await expect(
      sendResendEmail({ to: 'student@example.com', subject: 's', html: '<p>x</p>' }),
    ).rejects.toThrow('Invalid from address');
  });

  it('surfaces network failures from fetch', async () => {
    getEnv.mockImplementation((key) => {
      if (key === RESEND_API_KEY_ENV) return 're_test_key';
      if (key === RESEND_FROM_ENV) return 'notify@example.com';
      return undefined;
    });
    fetchFn.mockRejectedValue(new Error('network down'));

    const { sendResendEmail } = createResendEmailSender({ getEnv, fetchFn });
    await expect(
      sendResendEmail({ to: 'student@example.com', subject: 's', html: '<p>x</p>' }),
    ).rejects.toThrow('network down');
  });

  it('batch send records per-index failures without automatic retries', async () => {
    getEnv.mockImplementation((key) => {
      if (key === RESEND_API_KEY_ENV) return 're_test_key';
      if (key === RESEND_FROM_ENV) return 'notify@example.com';
      return undefined;
    });
    fetchFn
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: '1' }) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ message: 'fail' }) });

    const { sendResendEmailBatch } = createResendEmailSender({ getEnv, fetchFn });
    const batch = await sendResendEmailBatch([
      { to: 'a@example.com', subject: 's', html: '<p>1</p>' },
      { to: 'b@example.com', subject: 's', html: '<p>2</p>' },
    ]);

    expect(batch.sent).toBe(1);
    expect(batch.failed).toBe(1);
    expect(batch.errors).toEqual([{ index: 1, message: 'fail' }]);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });
});
