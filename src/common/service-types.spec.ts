import {
  SERVICE_TYPES,
  serviceTypeKey,
  serviceTypeLabel,
} from './service-types';

describe('xizmat turlari tarjimasi', () => {
  it('bazadagi ruscha nomlar kalitga moslanadi', () => {
    expect(serviceTypeKey('Авиабилет')).toBe('avia');
    expect(serviceTypeKey('Авиа')).toBe('avia');
    expect(serviceTypeKey('Отель')).toBe('hotel');
    expect(serviceTypeKey('Трансфер')).toBe('transfer');
    expect(serviceTypeKey('Тур')).toBe('tour');
    expect(serviceTypeKey('Страховка')).toBe('insurance');
    expect(serviceTypeKey('Экскурсия')).toBe('excursion');
    expect(serviceTypeKey('Прочее')).toBe('other');
  });

  it('tanlangan tilda nom, topilmasa asl qiymat', () => {
    expect(serviceTypeLabel('Отель', 'uz')).toBe('Mehmonxona');
    expect(serviceTypeLabel('Отель', 'ru')).toBe('Отель');
    expect(serviceTypeLabel('Тур', 'uz')).toBe('Tur paket');
    expect(serviceTypeLabel('Прочее', 'uz')).toBe('Boshqa');
    expect(serviceTypeLabel('Viza Express', 'uz')).toBe('Viza Express');
  });

  it('ranglar', () => {
    expect(SERVICE_TYPES.avia.color).toBe('#5EA8FF');
    expect(SERVICE_TYPES.hotel.color).toBe('#B794FF');
    expect(SERVICE_TYPES.transfer.color).toBe('#F2A65A');
    expect(SERVICE_TYPES.insurance.color).toBe('#4FD1A5');
    expect(SERVICE_TYPES.tour.color).toBe('#F472B6');
    expect(SERVICE_TYPES.excursion.color).toBe('#A3E635');
    expect(SERVICE_TYPES.other.color).toBe('#A3ABBF');
  });
});
