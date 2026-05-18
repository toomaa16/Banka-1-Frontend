import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

import {
  AppNotification,
  AppNotificationCategory,
  AppNotificationKind,
} from '../models/app-notification.model';
import { ToastService } from './toast.service';

const MAX_NOTIFICATIONS = 50;
const DEDUPE_WINDOW_MS = 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class AppNotificationService {
  private readonly itemsSubject = new BehaviorSubject<AppNotification[]>([]);
  readonly notifications$ = this.itemsSubject.asObservable();

  constructor(private toast: ToastService) {}

  get snapshot(): AppNotification[] {
    return this.itemsSubject.value;
  }

  get unreadCount(): number {
    return this.snapshot.filter((n) => !n.read).length;
  }

  push(params: {
    category: AppNotificationCategory;
    kind: AppNotificationKind;
    message: string;
    dedupeKey: string;
    route?: string;
    showToast?: boolean;
  }): void {
    const now = Date.now();
    const existing = this.snapshot.find(
      (n) =>
        n.dedupeKey === params.dedupeKey &&
        now - new Date(n.createdAt).getTime() < DEDUPE_WINDOW_MS,
    );
    if (existing) return;

    const notification: AppNotification = {
      id: `${params.kind}-${now}-${Math.random().toString(36).slice(2, 8)}`,
      category: params.category,
      kind: params.kind,
      message: params.message,
      createdAt: new Date().toISOString(),
      read: false,
      route: params.route,
      dedupeKey: params.dedupeKey,
    };

    const next = [notification, ...this.snapshot].slice(0, MAX_NOTIFICATIONS);
    this.itemsSubject.next(next);

    if (params.showToast !== false) {
      this.toast.info(params.message);
    }
  }

  markRead(id: string): void {
    this.itemsSubject.next(
      this.snapshot.map((n) => (n.id === id ? { ...n, read: true } : n)),
    );
  }

  markAllRead(): void {
    this.itemsSubject.next(this.snapshot.map((n) => ({ ...n, read: true })));
  }

  clear(): void {
    this.itemsSubject.next([]);
  }
}
