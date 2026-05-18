import { Injectable, OnDestroy } from '@angular/core';
import { forkJoin, of, Subscription, timer } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';

import { AuthService } from '../../../core/services/auth.service';
import { AppNotificationService } from '../../../shared/services/app-notification.service';
import { OtcService } from './otc.service';
import {
  detectContractExpiryNotifications,
  detectOfferNotifications,
  OfferSnapshot,
  toOfferSnapshot,
} from './otc-notification-diff';

declare global {
  interface Window {
    /** Samo za Cypress E2E — ubrzava poll (npr. 500). */
    __OTC_POLL_MS?: number;
  }
}

const POLL_INTERVAL_MS =
  typeof window !== 'undefined' && window.__OTC_POLL_MS != null
    ? window.__OTC_POLL_MS
    : 30_000;
const OTC_PERMISSIONS = [
  'OTC_TRADE',
  'CLIENT_TRADING',
  'TRADE_UNLIMITED',
  'SECURITIES_TRADE_UNLIMITED',
  'SECURITIES_TRADE_LIMITED',
];

/**
 * Celina 4 — OTC notifikacije u aplikaciji.
 * Prati aktivne ponude i ugovore; email obaveštenja šalje backend preko notification-service-a.
 */
@Injectable({ providedIn: 'root' })
export class OtcNotificationMonitorService implements OnDestroy {
  private pollSub?: Subscription;
  private offerSnapshot = new Map<string, OfferSnapshot>();
  private contractExpiryNotified = new Set<string>();
  private initialPollDone = false;

  constructor(
    private otcService: OtcService,
    private auth: AuthService,
    private notifications: AppNotificationService,
  ) {}

  start(): void {
    if (this.pollSub || !this.canMonitor()) return;

    this.pollSub = timer(0, POLL_INTERVAL_MS)
      .pipe(switchMap(() => this.pollOnce()))
      .subscribe();
  }

  stop(): void {
    this.pollSub?.unsubscribe();
    this.pollSub = undefined;
    this.offerSnapshot.clear();
    this.contractExpiryNotified.clear();
    this.initialPollDone = false;
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private canMonitor(): boolean {
    if (!this.auth.getToken()) return false;
    const user = this.auth.getLoggedUser();
    if (!user?.permissions?.length) return false;
    return user.permissions.some((p) => OTC_PERMISSIONS.includes(p));
  }

  private pollOnce() {
    return forkJoin({
      offers: this.otcService.getActiveOffers().pipe(catchError(() => of([]))),
      contracts: this.otcService.myContracts('ACTIVE').pipe(catchError(() => of([]))),
    }).pipe(
      switchMap(({ offers, contracts }) => {
        const userId = this.auth.getUserIdFromToken();
        const isInitial = !this.initialPollDone;

        const offerEvents = detectOfferNotifications(
          this.offerSnapshot,
          offers,
          userId,
          isInitial,
        );

        const contractEvents = detectContractExpiryNotifications(contracts, userId).filter(
          (n) => {
            if (this.contractExpiryNotified.has(n.dedupeKey)) return false;
            this.contractExpiryNotified.add(n.dedupeKey);
            return true;
          },
        );

        for (const item of offerEvents) {
          this.notifications.push({
            category: 'OTC',
            kind: item.kind,
            message: item.message,
            dedupeKey: item.dedupeKey,
            route: item.route,
            showToast: true,
          });
        }

        for (const item of contractEvents) {
          this.notifications.push({
            category: 'OTC',
            kind: item.kind,
            message: item.message,
            dedupeKey: item.dedupeKey,
            route: item.route,
            showToast: !isInitial,
          });
        }

        this.offerSnapshot = new Map(offers.map((o) => [toOfferSnapshot(o).key, toOfferSnapshot(o)]));
        this.initialPollDone = true;
        return of(null);
      }),
    );
  }
}
