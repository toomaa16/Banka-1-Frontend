import { OtcOffer } from '../models/otc.model';
import {
  detectContractExpiryNotifications,
  detectOfferNotifications,
  daysUntilSettlement,
  toOfferSnapshot,
} from './otc-notification-diff';

function offer(partial: Partial<OtcOffer> & Pick<OtcOffer, 'id' | 'stockTicker' | 'buyerId' | 'sellerId'>): OtcOffer {
  return {
    amount: 10,
    pricePerStock: 100,
    premium: 50,
    settlementDate: '2027-06-01',
    status: 'PENDING_BUYER',
    modifiedBy: '2',
    lastModified: '',
    ...partial,
  };
}

describe('otc-notification-diff', () => {
  it('detects counter-offer when terms change and it is user turn', () => {
    const before = toOfferSnapshot(
      offer({ id: 1, stockTicker: 'AAPL', buyerId: 1, sellerId: 2, pricePerStock: 100 }),
    );
    const prev = new Map([[before.key, before]]);
    const current = [
      offer({
        id: 1,
        stockTicker: 'AAPL',
        buyerId: 1,
        sellerId: 2,
        status: 'PENDING_BUYER',
        pricePerStock: 110,
      }),
    ];

    const events = detectOfferNotifications(prev, current, 1, false);
    expect(events.some((e) => e.kind === 'OTC_COUNTER_OFFER')).toBe(true);
  });

  it('does not emit on initial poll', () => {
    const current = [offer({ id: 1, stockTicker: 'AAPL', buyerId: 1, sellerId: 2 })];
    const events = detectOfferNotifications(new Map(), current, 1, true);
    expect(events.length).toBe(0);
  });

  it('detects withdrawn offer removed from active list', () => {
    const before = toOfferSnapshot(
      offer({ id: 5, stockTicker: 'MSFT', buyerId: 1, sellerId: 3, status: 'PENDING_SELLER' }),
    );
    const prev = new Map([[before.key, before]]);
    const events = detectOfferNotifications(prev, [], 1, false);
    expect(events.some((e) => e.kind === 'OTC_OFFER_WITHDRAWN')).toBe(true);
  });

  it('detects contract expiring within warning window', () => {
    const soon = new Date();
    soon.setDate(soon.getDate() + 2);
    const iso = soon.toISOString().substring(0, 10);

    const events = detectContractExpiryNotifications(
      [
        {
          id: 9,
          offerId: 1,
          stockTicker: 'AAPL',
          buyerId: 1,
          sellerId: 2,
          amount: 10,
          pricePerStock: 100,
          settlementDate: iso,
          status: 'ACTIVE',
          createdAt: '',
        },
      ],
      1,
    );

    expect(events.length).toBe(1);
    expect(events[0].kind).toBe('OTC_CONTRACT_EXPIRING');
  });

  it('daysUntilSettlement returns positive days for future date', () => {
    const future = new Date();
    future.setDate(future.getDate() + 5);
    const days = daysUntilSettlement(future.toISOString().substring(0, 10));
    expect(days).toBe(5);
  });
});
