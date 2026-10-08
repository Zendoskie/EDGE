import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { NotificationInboxTrigger } from '@/components/NotificationInboxTrigger';
import {
  NotificationInboxProvider,
  useNotificationInbox,
} from '@/contexts/NotificationInboxContext';
import { TooltipProvider } from '@/components/ui/tooltip';

function AddNotificationButton() {
  const { addNotification } = useNotificationInbox();
  return (
    <button
      type="button"
      onClick={() =>
        addNotification({
          title: 'Grade posted',
          body: 'Your assignment was graded.',
          sourceName: 'Professor Rivera',
        })
      }
    >
      Add notification
    </button>
  );
}

describe('NotificationInboxTrigger', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('shows and persists the notification source name', async () => {
    render(
      <NotificationInboxProvider userId="student-1">
        <TooltipProvider>
          <AddNotificationButton />
          <NotificationInboxTrigger />
        </TooltipProvider>
      </NotificationInboxProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add notification' }));
    fireEvent.click(screen.getByRole('button', { name: /Notifications, 1 unread/i }));

    expect(await screen.findByText('From Professor Rivera')).toBeInTheDocument();

    await waitFor(() => {
      const stored = JSON.parse(
        localStorage.getItem('edge_notification_inbox_student-1') ?? '[]',
      ) as Array<{ sourceName?: string }>;
      expect(stored[0]?.sourceName).toBe('Professor Rivera');
    });
  });

  it('keeps a durable notification visible and marks it read when the bell opens', async () => {
    function AddDurable() {
      const { addNotification } = useNotificationInbox();
      return (
        <button
          type="button"
          onClick={() =>
            addNotification({
              title: 'Counseling referral',
              body: 'You received a counseling referral. Status: Pending.',
              sourceName: 'Course Instructor',
              serverId: 'row-1',
              dedupeKey: 'user-inbox-notification:row-1',
            })
          }
        >
          Add durable
        </button>
      );
    }

    render(
      <NotificationInboxProvider userId="student-1">
        <TooltipProvider>
          <AddDurable />
          <NotificationInboxTrigger />
        </TooltipProvider>
      </NotificationInboxProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Add durable' }));
    expect(screen.getByRole('button', { name: /Notifications, 1 unread/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Notifications, 1 unread/i }));

    expect(await screen.findByText('Counseling referral')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Open notifications' })).toBeInTheDocument();
    });
    const stored = JSON.parse(
      localStorage.getItem('edge_notification_inbox_student-1') ?? '[]',
    ) as Array<{ serverId?: string; read?: boolean; title?: string }>;
    expect(stored).toHaveLength(1);
    expect(stored[0]?.serverId).toBe('row-1');
    expect(stored[0]?.read).toBe(true);
  });
});
