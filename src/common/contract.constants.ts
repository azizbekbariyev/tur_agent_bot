/**
 * Shartnoma bo'limi va to'lovlar uchun ro'yxatlar (bazadagi enum qiymatlari).
 * Bu qiymatlar migratsiya Shartnoma1764000000000 bilan bir xil bo'lishi SHART:
 * synchronize: true bo'lgani uchun farq bo'lsa, TypeORM bazadagi enum'ni o'zi o'zgartirishga urinadi.
 */

/** To'lov turlari. Eski CARD va TRANSFER migratsiyada CARD_TRANSFER ga o'tkazilgan (4-qism qarori) */
export const PAYMENT_TYPES = [
  'CASH', // Naqd
  'CARD_TRANSFER', // Kartaga o'tkazma
  'INSTALLMENT', // Bo'lib to'lash (bank / muddatli to'lov tizimi) - provider_id majburiy
  'BANK_ACCOUNT', // Hisob raqamga o'tkazma
  'TERMINAL', // Terminal
] as const;
export type PaymentTypeValue = (typeof PAYMENT_TYPES)[number];

/** To'lov qayerdan kelgan: qo'lda (kassadagi «To'lov» oynasi) yoki shartnoma yaratilganda */
export const PAYMENT_SOURCES = ['manual', 'contract_create'] as const;
export type PaymentSource = (typeof PAYMENT_SOURCES)[number];

export const CONTRACT_STATUSES = [
  'draft', // Qoralama
  'issued', // Berilgan
  'signed', // Imzolangan
  'changed', // Berilgandan keyin o'zgargan - qayta imzo
  'cancelled', // Bekor qilingan
] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const CONTRACT_LANGS = ['ru', 'uz'] as const;
export const INSURANCE_MODES = ['included', 'not_included'] as const;
export const VISA_MODES = ['included', 'not_included', 'not_required'] as const;

export const HOTEL_PLACEMENTS = ['SGL', 'DBL', 'TWN', 'TRPL'] as const;
export const HOTEL_MEALS = ['RO', 'BB', 'HB', 'FB', 'AI', 'UAI'] as const;
export const TRANSFER_TYPES = ['group', 'individual', 'none'] as const;
/** full: aeroport - mehmonxona - aeroport; arrival: faqat kutib olish; departure: faqat kuzatish */
export const TRANSFER_ROUTES = ['full', 'arrival', 'departure'] as const;

export const EXTRA_PAYMENT_MODES = ['included', 'separate'] as const;
export const VERSION_CHANNELS = ['print', 'pdf', 'telegram'] as const;

/** Kassa xizmati shartnomaning qaysi qatoriga bog'langan. Transfer - mehmonxona qatoriga (shahar bo'yicha) */
export const LINK_ITEM_TYPES = [
  'flight',
  'hotel',
  'extra',
  'insurance',
  'visa',
] as const;
export type LinkItemType = (typeof LINK_ITEM_TYPES)[number];
