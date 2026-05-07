import { useCallback, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  getRecentPanelNotifications,
  type PanelNotification,
} from '@/services/panelNotifications.service';
import { useClinicContext } from './useClinicContext';

const STORAGE_KEY = 'lucycare_panel_notif_seen_at';

function readSeenAt(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return 0;
    const n = parseInt(raw, 10);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

function writeSeenAt(ts: number) {
  try {
    localStorage.setItem(STORAGE_KEY, String(ts));
  } catch {
    // Ignorar — modo privado o storage lleno
  }
}

export interface UsePanelNotificationsResult {
  notifications: PanelNotification[];
  unreadCount: number;
  isLoading: boolean;
  isFetching: boolean;
  markAllAsRead: () => void;
}

export function usePanelNotifications(): UsePanelNotificationsResult {
  const { data: ctx } = useClinicContext();
  const [seenAt, setSeenAt] = useState<number>(readSeenAt);

  // Sincroniza si otra pestaña actualiza el storage
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setSeenAt(readSeenAt());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const query = useQuery({
    queryKey: ['panel-notifications', ctx?.doctorId],
    queryFn: () => getRecentPanelNotifications(ctx!.doctorId),
    enabled: !!ctx?.doctorId,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const notifications = query.data ?? [];
  const unreadCount = notifications.filter(
    (n) => new Date(n.eventAt).getTime() > seenAt
  ).length;

  const markAllAsRead = useCallback(() => {
    const now = Date.now();
    writeSeenAt(now);
    setSeenAt(now);
  }, []);

  return {
    notifications,
    unreadCount,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    markAllAsRead,
  };
}

/**
 * Helper: ¿es esta notificación más nueva que el último seenAt?
 * Útil para resaltar items individuales en el dropdown.
 */
export function useIsUnread(): (n: PanelNotification) => boolean {
  const [seenAt, setSeenAt] = useState<number>(readSeenAt);

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key === STORAGE_KEY) setSeenAt(readSeenAt());
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return useCallback(
    (n: PanelNotification) => new Date(n.eventAt).getTime() > seenAt,
    [seenAt]
  );
}
