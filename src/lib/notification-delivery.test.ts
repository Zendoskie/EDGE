import { describe, expect, it } from 'vitest';
import {
  DURABLE_INBOX_POLL_MS,
  canReadInboxRow,
  durableInboxRetryDelay,
  durableRowToInboxInput,
  idsToAnnounce,
  readServerIdsToSync,
} from '@/lib/notification-delivery';

const referral = {
  id: 'row-1',
  title: 'Counseling referral',
  body: 'You received a counseling referral from the instructor. Status: Pending.',
  source_name: 'Course Instructor',
};

describe('notification delivery', () => {
  it('keeps the durable inbox poll at three minutes and retries a failed read only once', () => {
    expect(DURABLE_INBOX_POLL_MS).toBe(180_000);
    expect(durableInboxRetryDelay(0)).toBe(8_000);
    expect(durableInboxRetryDelay(1)).toBeNull();
  });

  it('turns a durable row into an unread bell item for that recipient only', () => {
    expect(durableRowToInboxInput(referral)).toEqual({
      title: 'Counseling referral',
      body: referral.body,
      sourceName: 'Course Instructor',
      dedupeKey: 'user-inbox-notification:row-1',
      serverId: 'row-1',
    });
    expect(canReadInboxRow('student-1', 'student-1')).toBe(true);
    expect(canReadInboxRow('student-1', 'other-user')).toBe(false);
  });

  it('does not mark the database row read until the bell item is marked read', () => {
    const unread = [{ read: false, serverId: 'row-1' }];
    expect(readServerIdsToSync(unread, new Set())).toEqual([]);
    expect(readServerIdsToSync([{ read: true, serverId: 'row-1' }], new Set())).toEqual(['row-1']);
    expect(readServerIdsToSync([{ read: true, serverId: 'row-1' }], new Set(['row-1']))).toEqual([]);
  });

  it('announces a pending admin item the first time it is seen and not again', () => {
    expect(idsToAnnounce(new Set(), ['staff-1', 'staff-1'])).toEqual(['staff-1']);
    expect(idsToAnnounce(new Set(['staff-1']), ['staff-1', 'staff-2'])).toEqual(['staff-2']);
  });

  it('drops a durable row that has no recipient payload', () => {
    expect(durableRowToInboxInput({ id: '', title: 'Grade posted', body: 'Quiz 1' })).toBeNull();
  });
});
