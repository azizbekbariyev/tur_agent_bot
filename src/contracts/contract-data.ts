/**
 * Shartnoma ma'lumotlarini yig'ish: bazadan to'liq to'plam (bundle), tekshiruv kirishi,
 * kvitansiya mazmuni (content) va uning xeshi, versiya snapshot'i.
 * Pul hisobi YANGI EMAS: brutto, to'langan, qarz - cash.utils (getBrutto, getPaidAmount, getDebt).
 */
import { createHash } from 'crypto';
import { EntityManager } from 'typeorm';
import { Contract } from '../bot/models/contract';
import { Cash } from '../bot/models/cash';
import { CashServiceContractLink } from '../bot/models/cash_service_contract_link';
import { ContractVersion } from '../bot/models/contract_version';
import { getBrutto, getDebt, getPaidAmount } from '../cash/cash.utils';
import { serviceTypeKey } from '../common/service-types';
import { tashkentDate } from '../common/date';
import { CheckInput, CheckService, nightsBetween } from './contract-check';
import type { AppSettings } from '../settings/settings.service';
import type { ReceiptInput } from './receipt-model';

export interface ContractBundle {
  contract: Contract;
  cash: Cash;
  links: CashServiceContractLink[];
}

const byPos = <T extends { position: number; id: number }>(a: T, b: T) =>
  a.position - b.position || a.id - b.id;
const byId = <T extends { id: number }>(a: T, b: T) => a.id - b.id;

/** Shartnoma + kassa + bog'lanishlar. Kassa o'chirilgan bo'lsa ham yuklanadi (chaqiruvchi tekshiradi) */
export async function loadContractBundle(
  manager: EntityManager,
  where: { contractId: number } | { cashId: number },
): Promise<ContractBundle | null> {
  const contract = await manager.getRepository(Contract).findOne({
    where:
      'contractId' in where
        ? { id: where.contractId }
        : { cashId: where.cashId },
    relations: { flights: true, hotels: true, extras: true, createdBy: true },
  });
  if (!contract) return null;
  const cash = await manager.getRepository(Cash).findOne({
    where: { id: contract.cashId },
    relations: {
      brutto: true,
      passengers: true,
      moneys: true,
      user: true,
      additionalUser: true,
      cashServices: { service: { serviceType: true } },
    },
  });
  if (!cash) return null;
  const links = await manager
    .getRepository(CashServiceContractLink)
    .find({ where: { contractId: contract.id }, order: { id: 'ASC' } });
  contract.flights.sort(byPos);
  contract.hotels.sort(byPos);
  contract.extras.sort(byPos);
  cash.passengers?.sort(byId);
  cash.moneys?.sort(byId);
  cash.cashServices?.sort(byId);
  return { contract, cash, links };
}

/** "TRIP COM — Aviabilet (JQRONC)" */
export function cashServiceLabel(cs: Cash['cashServices'][number]) {
  const s = cs.service;
  const name = s ? [s.company_name, s.name].filter(Boolean).join(' — ') : '';
  return `${name || `#${cs.id}`}${cs.code ? ` (${cs.code})` : ''}`;
}

export function checkServices(b: ContractBundle): CheckService[] {
  return (b.cash.cashServices ?? []).map((cs) => ({
    id: cs.id,
    typeKey: serviceTypeKey(cs.service?.serviceType?.name),
    label: cashServiceLabel(cs),
    links: b.links
      .filter((l) => l.cashServiceId === cs.id)
      .map((l) => ({
        itemType: l.itemType,
        flightId: l.flightId,
        hotelId: l.hotelId,
        extraId: l.extraId,
      })),
  }));
}

export function toCheckInput(
  b: ContractBundle,
  withServices = true,
): CheckInput {
  const { contract: c, cash } = b;
  return {
    tour: {
      departureDate: cashDay(cash.departure_date),
      returnDate: cashDay(cash.return_date),
      tourists: Number(cash.turist_count ?? 0),
      passengers: cash.passengers?.length ?? 0,
    },
    flights: c.flights.map((f) => ({
      id: f.id,
      position: f.position,
      fromCity: f.fromCity,
      toCity: f.toCity,
      baggagePaxCount: f.baggagePaxCount,
    })),
    hotels: c.hotels.map((h) => ({
      id: h.id,
      position: h.position,
      city: h.city,
      name: h.name,
      roomsCount: h.roomsCount,
      checkIn: h.checkIn,
      checkOut: h.checkOut,
      transferType: h.transferType,
      transferRoute: h.transferRoute,
      roomsSeparateConfirmed: h.roomsSeparateConfirmed,
    })),
    extras: c.extras.map((e) => ({
      id: e.id,
      position: e.position,
      name: e.name,
      city: e.city,
      paymentMode: e.paymentMode,
    })),
    insurance: c.insurance,
    visa: c.visa,
    services: withServices ? checkServices(b) : undefined,
  };
}

const fullName = (p?: { firstName?: string; lastName?: string | null }) =>
  p ? `${p.lastName ?? ''} ${p.firstName ?? ''}`.trim() : '';

const day = (d?: string | null) => (d ? String(d).slice(0, 10) : null);

/**
 * Kassa sanasi -> 'YYYY-MM-DD'. Frontend kassa sanasini Toshkent yarim tuni ISO ko'rinishida yuboradi
 * ('2026-11-25T00:00+05:00' -> '2026-11-24T19:00:00.000Z'): 10 ta belgiga kesish sanani bir kun oldinga surib yuborardi.
 * Oddiy 'YYYY-MM-DD' o'zgarishsiz qoladi.
 */
export function cashDay(value?: string | null): string | null {
  if (!value) return null;
  const v = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return tashkentDate(v) || null;
}

/**
 * Kvitansiya MAZMUNI - mijoz imzo qo'yadigan qism. Shu o'zgarsa (berilgandan keyin) - «O'zgargan».
 * Bunga KIRMAYDI: to'lovlar (to'langan/qoldiq - har to'lovda qayta imzo kerak emas), firma ma'lumoti va
 * shablon matnlari (Sozlamalar o'zgarsa eski shartnomalar «o'zgargan» bo'lib qolmasin), kvitansiya tili.
 */
export function buildContent(b: ContractBundle) {
  const { contract: c, cash } = b;
  const first = cash.passengers?.[0];
  const rate = Number(cash.brutto?.currency_amount ?? 0);
  return {
    number: c.number,
    client: { name: fullName(first), phone: first?.phoneNumber ?? null },
    passengers: (cash.passengers ?? []).map((p) => fullName(p)),
    tour: {
      destination: cash.destination,
      departureDate: cashDay(cash.departure_date),
      returnDate: cashDay(cash.return_date),
      nights: nightsBetween(
        cashDay(cash.departure_date),
        cashDay(cash.return_date),
      ),
      tourists: Number(cash.turist_count ?? 0),
    },
    flights: c.flights.map((f) => ({
      fromCity: f.fromCity,
      toCity: f.toCity,
      transitCity: f.transitCity,
      date: day(f.date),
      airline: f.airline,
      baggageType: f.baggageType,
      baggagePaxCount: f.baggagePaxCount,
    })),
    hotels: c.hotels.map((h) => ({
      city: h.city,
      name: h.name,
      stars: h.stars,
      roomType: h.roomType,
      placement: h.placement,
      roomsCount: h.roomsCount,
      meal: h.meal,
      checkIn: day(h.checkIn),
      checkOut: day(h.checkOut),
      nights: nightsBetween(h.checkIn, h.checkOut),
      transferType: h.transferType,
      transferRoute: h.transferType === 'none' ? null : h.transferRoute,
    })),
    extras: c.extras.map((e) => ({
      name: e.name,
      city: e.city,
      date: day(e.date),
      pax: e.pax,
      paymentMode: e.paymentMode,
      priceUsd: e.priceUsd === null ? null : Number(e.priceUsd),
    })),
    insurance: c.insurance,
    visa: c.visa,
    price: {
      amount: Number(cash.brutto?.amount ?? 0),
      currency: cash.brutto?.currency ?? 'UZS',
      rate: cash.brutto?.currency === 'UZS' ? 1 : rate,
      totalUzs: getBrutto(cash),
    },
  };
}
export type ContractContent = ReturnType<typeof buildContent>;

export const contentHash = (content: ContractContent) =>
  createHash('sha256').update(JSON.stringify(content)).digest('hex');

/** To'langan va qoldiq (so'mda va narx valyutasida) - mavjud hisob */
export function buildPayments(cash: Cash) {
  const paidUzs = getPaidAmount(cash);
  const debtUzs = getDebt(cash);
  const currency = cash.brutto?.currency ?? 'UZS';
  const rate = Number(cash.brutto?.currency_amount ?? 0);
  const inCurrency = (uzs: number) =>
    currency === 'UZS' || !rate ? uzs : Math.round((uzs / rate) * 100) / 100;
  return {
    paidUzs,
    debtUzs,
    currency,
    paidInCurrency: inCurrency(paidUzs),
    debtInCurrency: inCurrency(debtUzs),
  };
}

/** Versiya snapshot'i: kvitansiyaga chiqqan hamma narsa shu paytdagidek (keyin o'zgarmaydi) */
export function buildSnapshot(
  b: ContractBundle,
  settings: AppSettings,
  meta: { version: number; issuedAt: string; channel: string; lang: string },
  /** Logotip rasmining o'zi (PNG/JPEG): keyin logotip almashsa ham eski versiya o'sha rasm bilan ochiladi */
  logo: { mime: string; base64: string } | null = null,
) {
  const content = buildContent(b);
  return {
    ...meta,
    contractDate: tashkentDate(b.contract.createdAt) || null,
    // kassa sanasi (tur sotilgan kun) - «Курс на …» shu sana (kurs sotuvda belgilangan; versiya keyin yozilsa ham)
    saleDate: cashDay(b.cash.created_at as unknown as string) || null,
    contentHash: contentHash(content),
    firm: {
      name: settings.brand.name,
      address: settings.brand.address,
      phone: settings.brand.phone,
      telegram: settings.brand.telegram,
      logoUrl: settings.brand.logoUrl,
      logo,
    },
    texts: {
      warning: settings.contract.warning,
      terms: settings.contract.terms,
    },
    content,
    payments: buildPayments(b.cash),
  };
}
export type ContractSnapshot = ReturnType<typeof buildSnapshot>;

/**
 * Versiya snapshot'i -> kvitansiya modeli kirishi. Snapshot'da tur tarkibi `content` ichida saqlanadi,
 * model esa uni yuqori darajada kutadi - shu yerda yoyiladi (PDF va sig'ish tekshiruvi shundan foydalanadi).
 */
export function snapshotToReceiptInput(snap: ContractSnapshot): ReceiptInput {
  const c = (snap.content ?? {}) as Partial<ContractContent>;
  return {
    number: c.number,
    contractDate: snap.contractDate ?? null,
    saleDate: (snap as { saleDate?: string | null }).saleDate ?? null,
    issuedAt: snap.issuedAt,
    version: snap.version,
    firm: snap.firm,
    client: c.client,
    tour: c.tour,
    flights: c.flights,
    hotels: c.hotels,
    extras: c.extras,
    insurance: c.insurance,
    visa: c.visa,
    price: c.price,
    payments: snap.payments,
    texts: snap.texts,
  };
}

export async function latestVersion(
  manager: EntityManager,
  contractId: number,
): Promise<ContractVersion | null> {
  return manager.getRepository(ContractVersion).findOne({
    where: { contractId },
    order: { version: 'DESC' },
  });
}
