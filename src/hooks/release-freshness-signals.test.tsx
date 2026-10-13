import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEdgeRealtimeNotifications } from '@/hooks/useEdgeRealtimeNotifications';
import { useDurableInboxNotifications } from '@/hooks/useAccountApprovalNotification';
import { useStudentInboxPoll } from '@/hooks/useStudentInboxPoll';

type Handler = (payload: { eventType: string; new?: Record<string, unknown> }) => void;

const { bindings, channels, inbox, tables } = vi.hoisted(() => ({
  bindings: [] as Array<{ channel: string; table: string; event: string; handler: Handler }>,
  channels: [] as string[],
  inbox: { items: [] as Array<{ serverId?: string }> },
  tables: {
    predictions: [] as Array<Record<string, unknown>>,
    attendance: [] as Array<Record<string, unknown>>,
  },
}));

vi.mock('@/contexts/NotificationInboxContext', () => ({
  useNotificationInbox: () => ({
    items: inbox.items,
    addNotification: (n: { serverId?: string }) => inbox.items.push(n),
  }),
}));

vi.mock('@/lib/notification-sources', () => ({
  createProfileSourceCache: () => async () => 'Course Instructor',
  resolveSubjectInstructorSource: async () => 'Course Instructor',
  resolveProfileSource: async () => 'Course Instructor',
}));

vi.mock('@/integrations/supabase/client', () => {
  const result = (data: unknown) => ({ data, error: null });
  const chain = (table: string): Record<string, unknown> => {
    const rows = () =>
      table === 'predictions' ? tables.predictions : table === 'attendance' ? tables.attendance : [];
    const q: Record<string, unknown> = {};
    for (const m of ['select', 'eq', 'in', 'update', 'or', 'gt', 'order']) q[m] = () => q;
    q.limit = async () => result([]);
    q.maybeSingle = async () => result(null);
    q.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
      Promise.resolve(result(rows())).then(resolve, reject);
    return q;
  };
  return {
    supabase: {
      from: (table: string) => chain(table),
      channel: (name: string) => {
        channels.push(name);
        const ch = {
          on: (_kind: string, filter: { table: string; event: string }, handler: Handler) => {
            bindings.push({ channel: name, table: filter.table, event: filter.event, handler });
            return ch;
          },
          subscribe: () => ch,
        };
        return ch;
      },
      removeChannel: async () => {},
    },
  };
});

const RELEASE_KEY = ['final-grade-releases', 'student', 'stu-1'];

function setup() {
  const client = new QueryClient();
  const spy = vi.spyOn(client, 'invalidateQueries');
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const releaseInvalidations = () =>
    spy.mock.calls.filter(([arg]) => JSON.stringify(arg?.queryKey) === JSON.stringify(RELEASE_KEY)).length;
  return { wrapper, spy, releaseInvalidations };
}

const handlerFor = (table: string, event: string) => {
  const b = bindings.find((x) => x.table === table && x.event === event);
  if (!b) throw new Error(`no binding for ${table} ${event}`);
  return b.handler;
};

beforeEach(() => {
  bindings.length = 0;
  channels.length = 0;
  inbox.items.length = 0;
  tables.predictions = [];
  tables.attendance = [];
  localStorage.clear();
});

describe('student Realtime channel (existing edge-student-notify binding)', () => {
  it('adds no channel or binding; still one channel with four bindings', () => {
    const { wrapper } = setup();
    renderHook(() => useEdgeRealtimeNotifications('stu-1', 'student'), { wrapper });
    expect(channels).toEqual(['edge-student-notify-stu-1']);
    expect(bindings.map((b) => `${b.table}:${b.event}`)).toEqual([
      'predictions:INSERT',
      'predictions:UPDATE',
      'attendance:*',
      'student_engagement_summary:UPDATE',
    ]);
  });

  it('attendance INSERT/UPDATE and prediction INSERT/UPDATE refresh this student release query', () => {
    const { wrapper, releaseInvalidations } = setup();
    renderHook(() => useEdgeRealtimeNotifications('stu-1', 'student'), { wrapper });
    handlerFor('attendance', '*')({ eventType: 'UPDATE', new: { id: 'a1', status: 'absent', date: '2026-10-01' } });
    handlerFor('attendance', '*')({ eventType: 'INSERT', new: { id: 'a2', status: 'present', date: '2026-10-02' } });
    handlerFor('predictions', 'INSERT')({ eventType: 'INSERT', new: { id: 'p1' } });
    handlerFor('predictions', 'UPDATE')({ eventType: 'UPDATE', new: { id: 'p1' } });
    expect(releaseInvalidations()).toBe(4);
  });

  it('attendance DELETE and engagement updates do not refresh release status', () => {
    const { wrapper, releaseInvalidations } = setup();
    renderHook(() => useEdgeRealtimeNotifications('stu-1', 'student'), { wrapper });
    handlerFor('attendance', '*')({ eventType: 'DELETE', new: {} });
    handlerFor('student_engagement_summary', 'UPDATE')({ eventType: 'UPDATE', new: { student_id: 'stu-1' } });
    expect(releaseInvalidations()).toBe(0);
  });

  it('does not subscribe for non-students', () => {
    const { wrapper } = setup();
    renderHook(() => useEdgeRealtimeNotifications('par-1', 'parent'), { wrapper });
    expect(channels).toHaveLength(0);
  });
});

describe('durable inbox (existing durable-inbox binding)', () => {
  it('a new Grade posted or Missing grade row refreshes the student release query once', async () => {
    const { wrapper, releaseInvalidations } = setup();
    renderHook(() => useDurableInboxNotifications('stu-1', 'student'), { wrapper });
    const insert = handlerFor('user_inbox_notifications', 'INSERT');
    act(() => insert({ eventType: 'INSERT', new: { id: 'n1', title: 'Grade posted', body: 'PL101: Quiz 1' } }));
    expect(releaseInvalidations()).toBe(1);
    act(() => insert({ eventType: 'INSERT', new: { id: 'n1', title: 'Grade posted', body: 'PL101: Quiz 1' } }));
    expect(releaseInvalidations()).toBe(1);
    act(() => insert({ eventType: 'INSERT', new: { id: 'n2', title: 'Missing grade', body: 'PL101: Quiz 2' } }));
    expect(releaseInvalidations()).toBe(2);
  });

  it('unrelated inbox rows and non-student roles do not', () => {
    const student = setup();
    renderHook(() => useDurableInboxNotifications('stu-1', 'student'), { wrapper: student.wrapper });
    act(() =>
      handlerFor('user_inbox_notifications', 'INSERT')({
        eventType: 'INSERT',
        new: { id: 'n3', title: 'Account approved', body: 'Welcome' },
      }),
    );
    expect(student.releaseInvalidations()).toBe(0);

    bindings.length = 0;
    const parent = setup();
    renderHook(() => useDurableInboxNotifications('stu-1', 'parent'), { wrapper: parent.wrapper });
    act(() =>
      handlerFor('user_inbox_notifications', 'INSERT')({
        eventType: 'INSERT',
        new: { id: 'n4', title: 'Grade posted', body: 'PL101' },
      }),
    );
    expect(parent.releaseInvalidations()).toBe(0);
  });
});

describe('student inbox poll (existing 180 s poll)', () => {
  it('a new prediction or attendance row since the last poll refreshes the release query', async () => {
    tables.attendance = [{ id: 'a1', date: '2026-10-02', status: 'present', created_at: new Date().toISOString() }];
    const { wrapper, releaseInvalidations } = setup();
    renderHook(() => useStudentInboxPoll('stu-1', 'student'), { wrapper });
    await waitFor(() => expect(releaseInvalidations()).toBe(1));
  });

  it('nothing new since the last poll: no refresh', async () => {
    tables.predictions = [{ id: 'p-old', created_at: '2020-01-01T00:00:00Z', recommendation: null, subjects: null }];
    const { wrapper, releaseInvalidations } = setup();
    renderHook(() => useStudentInboxPoll('stu-1', 'student'), { wrapper });
    await waitFor(() => expect(localStorage.getItem('edge_inbox_poll_stu-1')).not.toBeNull());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(releaseInvalidations()).toBe(0);
  });
});
