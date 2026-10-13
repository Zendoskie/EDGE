import { beforeEach, describe, expect, it, vi } from 'vitest';

const { from, maybeSingle } = vi.hoisted(() => {
  const maybeSingle = vi.fn();
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ maybeSingle }) }),
  }));
  return { from, maybeSingle };
});

vi.mock('@/integrations/supabase/client', () => ({ supabase: { from } }));

import { createProfileSourceCache } from '@/lib/notification-sources';

describe('createProfileSourceCache', () => {
  beforeEach(() => {
    from.mockClear();
    maybeSingle.mockReset();
    maybeSingle.mockResolvedValue({ data: { full_name: 'Ms. Reyes', email: 'r@x.invalid' }, error: null });
  });

  it('looks up each actor once, including concurrent events', async () => {
    const source = createProfileSourceCache('Course Instructor');
    const names = await Promise.all([source('ins-1'), source('ins-1'), source('ins-1')]);
    expect(names).toEqual(['Ms. Reyes', 'Ms. Reyes', 'Ms. Reyes']);
    await source('ins-1');
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).toHaveBeenCalledWith('profiles');
  });

  it('looks up different actors separately', async () => {
    const source = createProfileSourceCache('Course Instructor');
    await source('ins-1');
    await source('ins-2');
    expect(from).toHaveBeenCalledTimes(2);
  });

  it('returns the fallback without a query when there is no actor', async () => {
    const source = createProfileSourceCache('Course Instructor');
    expect(await source(null)).toBe('Course Instructor');
    expect(await source(undefined)).toBe('Course Instructor');
    expect(from).not.toHaveBeenCalled();
  });

  it('falls back when the profile cannot be read', async () => {
    maybeSingle.mockResolvedValueOnce({ data: null, error: { message: 'denied' } });
    const source = createProfileSourceCache('Course Instructor');
    expect(await source('ins-3')).toBe('Course Instructor');
  });
});
