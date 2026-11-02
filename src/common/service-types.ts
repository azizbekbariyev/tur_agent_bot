/**
 * Xizmat turlari: bazadagi nom (ko'pincha ruscha: "Авиабилет", "Отель") o'zgarmaydi,
 * ko'rsatishda kalit bo'yicha tanlangan tilga o'giriladi. Frontend'dagi
 * src/lib/serviceTypes.ts bilan bir xil bo'lishi kerak.
 */
export type Lang = 'uz' | 'ru';

export const SERVICE_TYPES = {
  avia: {
    uz: 'Aviabilet',
    ru: 'Авиабилет',
    color: '#5EA8FF',
    aliases: ['авиабилет', 'авиабилеты', 'авиа', 'aviabilet', 'avia'],
  },
  hotel: {
    uz: 'Mehmonxona',
    ru: 'Отель',
    color: '#B794FF',
    aliases: ['отель', 'отели', 'гостиница', 'mehmonxona', 'hotel'],
  },
  transfer: {
    uz: 'Transfer',
    ru: 'Трансфер',
    color: '#F2A65A',
    aliases: ['трансфер', 'transfer'],
  },
  insurance: {
    uz: "Sug'urta",
    ru: 'Страховка',
    color: '#4FD1A5',
    aliases: ['страховка', 'страхование', "sug'urta", 'sug‘urta', 'sugurta'],
  },
  tour: {
    uz: 'Tur paket',
    ru: 'Тур',
    color: '#F472B6',
    aliases: ['тур', 'турпакет', 'tur', 'tur paket', 'turpaket'],
  },
  excursion: {
    uz: 'Ekskursiya',
    ru: 'Экскурсия',
    color: '#A3E635',
    aliases: ['экскурсия', 'экскурсии', 'ekskursiya'],
  },
  other: {
    uz: 'Boshqa',
    ru: 'Прочее',
    color: '#A3ABBF',
    aliases: ['прочее', 'другое', 'boshqa'],
  },
} as const;

export type ServiceTypeKey = keyof typeof SERVICE_TYPES;

export function serviceTypeKey(name?: string | null): ServiceTypeKey | null {
  const n = name?.trim().toLowerCase();
  if (!n) return null;
  for (const [key, def] of Object.entries(SERVICE_TYPES)) {
    if ((def.aliases as readonly string[]).includes(n)) {
      return key as ServiceTypeKey;
    }
  }
  return null;
}

/** Tanlangan tildagi nom; lug'atda topilmasa - bazadagi asl nom */
export function serviceTypeLabel(name: string | null | undefined, lang: Lang) {
  const key = serviceTypeKey(name);
  return key ? SERVICE_TYPES[key][lang] : (name ?? '');
}
