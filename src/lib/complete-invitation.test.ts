import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  signInWithPassword: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: mocks.rpc,
    auth: { signInWithPassword: mocks.signInWithPassword },
  },
}));

import {
  callCompleteInvitationRpc,
  isAlreadyRegisteredError,
  isObfuscatedExistingUser,
  signInExistingAccount,
  toErrorMessage,
} from '@/lib/complete-invitation';

describe('callCompleteInvitationRpc', () => {
  beforeEach(() => {
    mocks.rpc.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns immediately when the RPC succeeds', async () => {
    mocks.rpc.mockResolvedValue({ error: null });

    await expect(callCompleteInvitationRpc('complete_parent_invitation', { p_token: 'tok' }))
      .resolves.toEqual({ error: null });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('retries transient user_profile_not_found errors', async () => {
    vi.useFakeTimers();
    mocks.rpc
      .mockResolvedValueOnce({ error: { message: 'user_profile_not_found' } })
      .mockResolvedValueOnce({ error: { message: 'user_profile_not_found' } })
      .mockResolvedValueOnce({ error: null });

    const promise = callCompleteInvitationRpc('complete_parent_invitation', { p_token: 'tok' });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ error: null });
    expect(mocks.rpc).toHaveBeenCalledTimes(3);
  });

  it('gives up after the retry budget and returns the real message', async () => {
    vi.useFakeTimers();
    mocks.rpc.mockResolvedValue({ error: { message: 'user_profile_not_found' } });

    const promise = callCompleteInvitationRpc('complete_parent_invitation', { p_token: 'tok' });
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toEqual({ error: { message: 'user_profile_not_found' } });
    expect(mocks.rpc).toHaveBeenCalledTimes(7);
  });

  it('does not retry non-transient errors', async () => {
    mocks.rpc.mockResolvedValue({ error: { message: 'email_mismatch' } });

    await expect(callCompleteInvitationRpc('complete_staff_invitation', { p_token: 'tok' }))
      .resolves.toEqual({ error: { message: 'email_mismatch' } });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
});

describe('registration recovery helpers', () => {
  it('detects already-registered signUp errors', () => {
    expect(isAlreadyRegisteredError({ message: 'User already registered' })).toBe(true);
    expect(isAlreadyRegisteredError({ code: 'user_already_exists', message: '' })).toBe(true);
    expect(isAlreadyRegisteredError({ message: 'Password should be at least 6 characters' })).toBe(false);
    expect(isAlreadyRegisteredError(null)).toBe(false);
  });

  it('detects obfuscated existing users from signUp', () => {
    expect(isObfuscatedExistingUser({ identities: [] } as never)).toBe(true);
    expect(isObfuscatedExistingUser({ identities: [{}] } as never)).toBe(false);
    expect(isObfuscatedExistingUser({} as never)).toBe(false);
    expect(isObfuscatedExistingUser(null)).toBe(false);
  });

  it('signs in an existing account and reports whether a session was granted', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: { id: 'user-1' }, session: { access_token: 'token' } },
      error: null,
    });

    await expect(signInExistingAccount('parent@example.com', 'secret123'))
      .resolves.toEqual({ id: 'user-1', hasSession: true });
  });

  it('returns null when the existing account password does not match', async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { user: null, session: null },
      error: { message: 'Invalid login credentials' },
    });

    await expect(signInExistingAccount('parent@example.com', 'wrong'))
      .resolves.toBeNull();
  });

  it('surfaces plain-object RPC errors instead of a generic fallback', () => {
    expect(toErrorMessage({ message: 'invitation_expired' }, 'fallback')).toBe('invitation_expired');
    expect(toErrorMessage(new Error('boom'), 'fallback')).toBe('boom');
    expect(toErrorMessage(undefined, 'fallback')).toBe('fallback');
  });
});
