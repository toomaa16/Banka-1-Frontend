import { OptionContract, OtcOffer } from '../models/otc.model';

/** Days before settlement when users are warned (spec: npr. 3 dana). */
export const OTC_EXPIRY_WARNING_DAYS = 3;

export type OtcNotificationKind =
  | 'OTC_COUNTER_OFFER'
  | 'OTC_OFFER_ACCEPTED'
  | 'OTC_OFFER_REJECTED'
  | 'OTC_OFFER_WITHDRAWN'
  | 'OTC_CONTRACT_EXPIRING';

export interface DetectedOtcNotification {
  kind: OtcNotificationKind;
  dedupeKey: string;
  message: string;
  route?: string;
}

export interface OfferSnapshot {
  key: string;
  stockTicker: string;
  status: string;
  amount: number;
  pricePerStock: number;
  premium: number;
  settlementDate: string;
  modifiedBy: string;
  buyerId: number;
  sellerId: number;
}

export function offerSnapshotKey(o: OtcOffer): string {
  return o.interbank && o.localId ? `ib:${o.localId}` : `local:${o.id}`;
}

export function toOfferSnapshot(o: OtcOffer): OfferSnapshot {
  return {
    key: offerSnapshotKey(o),
    stockTicker: o.stockTicker,
    status: o.status,
    amount: o.amount,
    pricePerStock: o.pricePerStock,
    premium: o.premium,
    settlementDate: o.settlementDate,
    modifiedBy: o.modifiedBy,
    buyerId: o.buyerId,
    sellerId: o.sellerId,
  };
}

export function isUsersTurn(o: OfferSnapshot, userId: number | null): boolean {
  if (userId == null) return false;
  if (o.status === 'PENDING_SELLER') return userId === o.sellerId;
  if (o.status === 'PENDING_BUYER') return userId === o.buyerId;
  return false;
}

export function isParticipant(o: OfferSnapshot, userId: number | null): boolean {
  if (userId == null) return false;
  return userId === o.buyerId || userId === o.sellerId;
}

function termsChanged(a: OfferSnapshot, b: OfferSnapshot): boolean {
  return (
    a.amount !== b.amount ||
    a.pricePerStock !== b.pricePerStock ||
    a.premium !== b.premium ||
    a.settlementDate !== b.settlementDate ||
    a.modifiedBy !== b.modifiedBy
  );
}

function pendingStatuses(): Set<string> {
  return new Set(['PENDING_BUYER', 'PENDING_SELLER']);
}

export function detectOfferNotifications(
  prev: Map<string, OfferSnapshot>,
  current: OtcOffer[],
  userId: number | null,
  isInitial: boolean,
): DetectedOtcNotification[] {
  if (isInitial || userId == null) return [];

  const out: DetectedOtcNotification[] = [];
  const currentMap = new Map(current.map((o) => [offerSnapshotKey(o), toOfferSnapshot(o)]));

  for (const [key, snap] of currentMap) {
    const before = prev.get(key);
    if (!before) continue;

    if (snap.status === 'ACCEPTED' && before.status !== 'ACCEPTED' && isParticipant(snap, userId)) {
      out.push({
        kind: 'OTC_OFFER_ACCEPTED',
        dedupeKey: `offer:${key}:accepted`,
        message: `Ponuda za ${snap.stockTicker} je prihvaćena.`,
        route: '/otc',
      });
      continue;
    }

    if (snap.status === 'REJECTED' && before.status !== 'REJECTED' && isParticipant(snap, userId)) {
      out.push({
        kind: 'OTC_OFFER_REJECTED',
        dedupeKey: `offer:${key}:rejected`,
        message: `Ponuda za ${snap.stockTicker} je odbijena.`,
        route: '/otc',
      });
      continue;
    }

    if (
      pendingStatuses().has(snap.status) &&
      isUsersTurn(snap, userId) &&
      (!isUsersTurn(before, userId) || termsChanged(before, snap))
    ) {
      out.push({
        kind: 'OTC_COUNTER_OFFER',
        dedupeKey: `offer:${key}:counter:${snap.modifiedBy}:${snap.amount}:${snap.pricePerStock}`,
        message: `Druga strana je poslala kontraponudu za ${snap.stockTicker}.`,
        route: '/otc',
      });
    }
  }

  for (const [key, before] of prev) {
    if (currentMap.has(key)) continue;
    if (!pendingStatuses().has(before.status) || !isParticipant(before, userId)) continue;
    out.push({
      kind: 'OTC_OFFER_WITHDRAWN',
      dedupeKey: `offer:${key}:withdrawn`,
      message: `Druga strana je odustala od ponude za ${before.stockTicker}.`,
      route: '/otc',
    });
  }

  return out;
}

export function daysUntilSettlement(settlementDate: string): number | null {
  const raw = settlementDate?.includes('T')
    ? settlementDate.substring(0, 10)
    : settlementDate;
  if (!raw) return null;
  const settlement = new Date(`${raw}T00:00:00`);
  if (Number.isNaN(settlement.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.ceil((settlement.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function detectContractExpiryNotifications(
  contracts: OptionContract[],
  userId: number | null,
  warningDays: number = OTC_EXPIRY_WARNING_DAYS,
): DetectedOtcNotification[] {
  if (userId == null) return [];

  const out: DetectedOtcNotification[] = [];
  for (const c of contracts) {
    if (c.status !== 'ACTIVE') continue;
    if (c.buyerId !== userId && c.sellerId !== userId) continue;

    const days = daysUntilSettlement(c.settlementDate);
    if (days == null || days <= 0 || days > warningDays) continue;

    const dateLabel = c.settlementDate?.includes('T')
      ? c.settlementDate.substring(0, 10)
      : c.settlementDate;

    out.push({
      kind: 'OTC_CONTRACT_EXPIRING',
      dedupeKey: `contract:${c.id}:expiry:${dateLabel}`,
      message: `Opcioni ugovor za ${c.stockTicker} ističe za ${days} ${
        days === 1 ? 'dan' : 'dana'
      } (settlement: ${dateLabel}).`,
      route: '/otc',
    });
  }
  return out;
}
