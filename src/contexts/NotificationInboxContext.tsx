import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type InboxNotification = {
  id: string;
  /** When set, prevents duplicate entries (Realtime + polling). */
  dedupeKey?: string;
  title: string;
  body: string;
  createdAt: number;
  read: boolean;
};

const MAX_ITEMS = 100;

function storageKey(userId: string) {
  return `edge_notification_inbox_${userId}`;
}

function loadFromStorage(userId: string): InboxNotification[] {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (x): x is InboxNotification =>
        x &&
        typeof x === "object" &&
        typeof (x as InboxNotification).id === "string" &&
        typeof (x as InboxNotification).title === "string" &&
        typeof (x as InboxNotification).body === "string" &&
        typeof (x as InboxNotification).createdAt === "number" &&
        typeof (x as InboxNotification).read === "boolean",
    );
  } catch {
    return [];
  }
}

type AddInput = { title: string; body: string; dedupeKey?: string };

type InboxContextValue = {
  items: InboxNotification[];
  unreadCount: number;
  addNotification: (input: AddInput) => void;
  markAllRead: () => void;
  clearAll: () => void;
};

const NotificationInboxContext = createContext<InboxContextValue | null>(null);

export function NotificationInboxProvider({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const [items, setItems] = useState<InboxNotification[]>(() => loadFromStorage(userId));

  useEffect(() => {
    setItems(loadFromStorage(userId));
  }, [userId]);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify(items));
    } catch {
      /* ignore quota */
    }
  }, [userId, items]);

  const addNotification = useCallback((input: AddInput) => {
    setItems((prev) => {
      if (input.dedupeKey && prev.some((i) => i.dedupeKey === input.dedupeKey)) {
        return prev;
      }
      const n: InboxNotification = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        dedupeKey: input.dedupeKey,
        title: input.title,
        body: input.body,
        createdAt: Date.now(),
        read: false,
      };
      return [n, ...prev].slice(0, MAX_ITEMS);
    });
  }, []);

  const markAllRead = useCallback(() => {
    setItems((prev) => prev.map((i) => ({ ...i, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setItems([]);
  }, []);

  const unreadCount = useMemo(() => items.filter((i) => !i.read).length, [items]);

  const value = useMemo(
    () => ({
      items,
      unreadCount,
      addNotification,
      markAllRead,
      clearAll,
    }),
    [items, unreadCount, addNotification, markAllRead, clearAll],
  );

  return (
    <NotificationInboxContext.Provider value={value}>{children}</NotificationInboxContext.Provider>
  );
}

export function useNotificationInbox() {
  const ctx = useContext(NotificationInboxContext);
  if (!ctx) {
    throw new Error("useNotificationInbox must be used within NotificationInboxProvider");
  }
  return ctx;
}
