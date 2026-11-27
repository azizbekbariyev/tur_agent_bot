import { BadRequestException, Type, ValidationPipe } from '@nestjs/common';
import { CreateCashDto, CreatePaymantDto, UpdateCashDto } from './cash.dto';

// main.ts dagi bilan bir xil sozlama
const pipe = new ValidationPipe({ whitelist: true, transform: true });
const run = (metatype: Type<unknown>, value: unknown) =>
  pipe.transform(value, { type: 'body', metatype });

const payment = (type: string) => ({
  amount: 100,
  currency: 'USD',
  currency_amount: 12000,
  type,
});

describe("Eski frontend bilan moslik: to'lov turi", () => {
  it.each([
    ['CARD', 'CARD_TRANSFER'],
    ['TRANSFER', 'CARD_TRANSFER'],
    ['CASH', 'CASH'],
    ['CARD_TRANSFER', 'CARD_TRANSFER'],
    ['TERMINAL', 'TERMINAL'],
    ['BANK_ACCOUNT', 'BANK_ACCOUNT'],
    ['INSTALLMENT', 'INSTALLMENT'],
  ])("«To'lov» oynasi: %s -> %s", async (input, expected) => {
    const dto = (await run(
      CreatePaymantDto,
      payment(input),
    )) as CreatePaymantDto;
    expect(dto.type).toBe(expected);
  });

  it("noma'lum tur rad etiladi", async () => {
    await expect(run(CreatePaymantDto, payment('BITCOIN'))).rejects.toThrow(
      BadRequestException,
    );
  });

  it("kassa yaratishda to'lovlar ro'yxati ham o'giriladi", async () => {
    const dto = (await run(CreateCashDto, {
      destination: 'Dubay',
      departure_date: '2026-12-01',
      return_date: '2026-12-08',
      comment: '',
      turist_count: 2,
      status: 'draft',
      brutto: { amount: 1000, currency: 'USD', currency_amount: 12000 },
      services: [],
      passengers: [],
      moneys: [
        {
          money_received: 10,
          currency: 'UZS',
          currency_amount: 1,
          type: 'TRANSFER',
        },
        {
          money_received: 20,
          currency: 'UZS',
          currency_amount: 1,
          type: 'CARD',
        },
        {
          money_received: 30,
          currency: 'UZS',
          currency_amount: 1,
          type: 'CASH',
        },
      ],
    })) as CreateCashDto;
    expect(dto.moneys.map((m) => m.type)).toEqual([
      'CARD_TRANSFER',
      'CARD_TRANSFER',
      'CASH',
    ]);
  });

  it("kassani tahrirlashda to'lovlar ham o'giriladi", async () => {
    const dto = (await run(UpdateCashDto, {
      moneys: [
        {
          money_received: 5,
          currency: 'UZS',
          currency_amount: 1,
          type: 'CARD',
        },
      ],
    })) as UpdateCashDto;
    expect(dto.moneys?.[0].type).toBe('CARD_TRANSFER');
  });
});
