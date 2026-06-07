import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import { useAuth } from "./auth-context";

export interface Notification {
  id: string;
  fileName: string;
  status: "success" | "error" | "warning";
  message: string;
  timestamp: number;
  read: boolean;
}

interface NotificationsContextType {
  notifications: Notification[];
  unreadCount: number;
  addNotification: (n: Omit<Notification, "id" | "timestamp" | "read">) => void;
  markAllRead: () => void;
  clearAll: () => void;
}

const NotificationsContext = createContext<NotificationsContextType | undefined>(undefined);

export function NotificationsProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  const [notifications, setNotifications] = useState<Notification[]>([]);

  const getStorageKey = useCallback(() => {
    return user ? `wom_notifications_${user.uid}` : null;
  }, [user]);

  // Load notifications when user changes
  useEffect(() => {
    const key = getStorageKey();
    if (key) {
      try {
        const stored = localStorage.getItem(key);
        setNotifications(stored ? (JSON.parse(stored) as Notification[]) : []);
      } catch {
        setNotifications([]);
      }
    } else {
      setNotifications([]);
    }
  }, [user, getStorageKey]);

  // Save notifications when they change
  useEffect(() => {
    const key = getStorageKey();
    if (key) {
      localStorage.setItem(key, JSON.stringify(notifications));
    }
  }, [notifications, getStorageKey]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  const addNotification = useCallback(
    (n: Omit<Notification, "id" | "timestamp" | "read">) => {
      const newN: Notification = {
        ...n,
        id: (typeof crypto !== "undefined" && crypto.randomUUID)
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        timestamp: Date.now(),
        read: false,
      };
      setNotifications((prev) => [newN, ...prev].slice(0, 50));
    },
    []
  );

  const markAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const clearAll = useCallback(() => {
    setNotifications([]);
  }, []);

  return (
    <NotificationsContext.Provider
      value={{ notifications, unreadCount, addNotification, markAllRead, clearAll }}
    >
      {children}
    </NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const ctx = useContext(NotificationsContext);
  if (!ctx) throw new Error("useNotifications must be used within NotificationsProvider");
  return ctx;
}
