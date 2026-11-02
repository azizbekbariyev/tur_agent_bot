import { BadGatewayException, Injectable, Logger } from '@nestjs/common';

const CBU_URL = 'https://cbu.uz/uz/arkhiv-kursov-valyut/json/';
const CACHE_TTL = 60 * 60 * 1000;
const CURRENCIES = ['USD', 'EUR', 'RUB'];

type Rates = Record<string, { rate: number; date: string }>;

@Injectable()
export class RatesService {
  private readonly logger = new Logger(RatesService.name);
  private cache: { data: Rates; at: number } | null = null;

  async getCbuRates(): Promise<Rates> {
    if (this.cache && Date.now() - this.cache.at < CACHE_TTL) {
      return this.cache.data;
    }
    try {
      const res = await fetch(CBU_URL, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const list = (await res.json()) as {
        Ccy: string;
        Rate: string;
        Nominal?: string;
        Date: string;
      }[];

      const data: Rates = {};
      for (const item of list) {
        if (!CURRENCIES.includes(item.Ccy)) continue;
        const [dd, mm, yyyy] = item.Date.split('.');
        data[item.Ccy] = {
          rate: Number(item.Rate) / Number(item.Nominal || 1),
          date: `${yyyy}-${mm}-${dd}`,
        };
      }
      this.cache = { data, at: Date.now() };
      return data;
    } catch (error) {
      this.logger.warn(`CBU kursini olishda xato: ${String(error)}`);
      // Eski kesh bo'lsa, eskirgan bo'lsa ham qaytaramiz
      if (this.cache) return this.cache.data;
      throw new BadGatewayException('Markaziy bank kursini olib bo‘lmadi');
    }
  }
}
