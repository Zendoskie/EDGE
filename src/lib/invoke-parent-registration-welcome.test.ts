import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendParentRegistrationWelcomeEmail } from '@/lib/invoke-parent-email';

describe('sendParentRegistrationWelcomeEmail', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'anon-test-key');
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('reports sent when the edge function succeeds', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, sent: 1, failed: 0 }),
    });

    const result = await sendParentRegistrationWelcomeEmail({ completion_token: 'tok-1' });
    expect(result).toEqual({ sent: true, failed: false, duplicate: false, error: null });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/functions/v1/send-parent-email');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      type: 'registration_access_activated',
      completion_token: 'tok-1',
    });
  });

  it('reports duplicate without failure', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, sent: 0, duplicate: true }),
    });

    const result = await sendParentRegistrationWelcomeEmail({ completion_token: 'tok-1' });
    expect(result.duplicate).toBe(true);
    expect(result.failed).toBe(false);
  });

  it('reports provider failure without throwing', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, sent: 0, failed: 1 }),
    });

    const result = await sendParentRegistrationWelcomeEmail({ completion_token: 'tok-1' });
    expect(result.failed).toBe(true);
    expect(result.sent).toBe(false);
  });

  it('reports HTTP errors from invalid completion', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ error: 'Invalid or incomplete registration' }),
    });

    const result = await sendParentRegistrationWelcomeEmail({ completion_token: 'bad' });
    expect(result.failed).toBe(true);
    expect(result.error).toContain('Invalid or incomplete registration');
  });
});
