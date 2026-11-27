/**
 * Saqlamasdan tekshirish: joriy forma holati (qoralama) mavjud shartnoma ma'lumotiga qo'llanadi va
 * YAGONA tekshiruv funksiyasi (checkContract) chaqiriladi. Bazaga hech narsa yozilmaydi.
 * Sof funksiya - testlar: contract-preview.spec.ts.
 */
import { CheckInput } from './contract-check';
import { ContractBodyDto } from './contracts.dto';

export function applyDraft(
  base: CheckInput,
  draft: ContractBodyDto,
): CheckInput {
  // Yangi (id yo'q) qatorlarga vaqtincha manfiy id: bog'lanishlar bilan adashmasligi uchun
  let tmp = 0;
  const flights = draft.flights
    ? draft.flights.map((f, i) => ({
        id: f.id ?? --tmp,
        position: i,
        fromCity: f.fromCity,
        toCity: f.toCity,
        baggagePaxCount: f.baggagePaxCount ?? 0,
      }))
    : base.flights;

  const hotels = draft.hotels
    ? draft.hotels.map((h, i) => {
        const prev = base.hotels.find((x) => x.id === h.id);
        const transferType = h.transferType ?? 'none';
        return {
          id: h.id ?? --tmp,
          position: i,
          city: h.city,
          name: h.name ?? null,
          roomsCount: h.roomsCount ?? 1,
          checkIn: h.checkIn ?? null,
          checkOut: h.checkOut ?? null,
          transferType,
          transferRoute:
            transferType === 'none' ? null : (h.transferRoute ?? 'full'),
          // «Har nomer alohida» tanlovi saqlangan qatorda qoladi (tahrirda o'zgarmaydi)
          roomsSeparateConfirmed: prev?.roomsSeparateConfirmed ?? false,
        };
      })
    : base.hotels;

  const extras = draft.extras
    ? draft.extras.map((e, i) => ({
        id: e.id ?? --tmp,
        position: i,
        name: e.name,
        city: e.city ?? null,
        paymentMode: e.paymentMode ?? 'included',
      }))
    : base.extras;

  // Olib tashlangan qatorlarga bog'lanishlar ham tushib qoladi (saqlanganda ON DELETE CASCADE)
  const flightIds = new Set(flights.map((f) => f.id));
  const hotelIds = new Set(hotels.map((h) => h.id));
  const extraIds = new Set(extras.map((e) => e.id));
  const services = base.services?.map((s) => ({
    ...s,
    links: s.links.filter((l) =>
      l.itemType === 'flight'
        ? flightIds.has(l.flightId ?? 0)
        : l.itemType === 'hotel'
          ? hotelIds.has(l.hotelId ?? 0)
          : l.itemType === 'extra'
            ? extraIds.has(l.extraId ?? 0)
            : true,
    ),
  }));

  return {
    ...base,
    flights,
    hotels,
    extras,
    insurance: draft.insurance ?? base.insurance,
    visa: draft.visa ?? base.visa,
    services,
  };
}
