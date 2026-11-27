import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

/**
 * Ochiq (loginsiz) endpointlar uchun IP bo'yicha so'rovlar cheklovi: daqiqasiga LIMIT ta, ortig'i - 429.
 * Xotirada (bitta jarayon; har filial alohida pm2 jarayoni). nginx'da ham alohida cheklov bor (ops/shartnoma).
 *
 * IP: to'g'ridan-to'g'ri ulanish manzili. Faqat so'rov shu serverning o'zidan (nginx, 127.0.0.1) kelgandagina
 * X-Real-IP / X-Forwarded-For ga ishoniladi - aks holda sarlavhani soxtalashtirib cheklovni chetlab bo'lmaydi.
 */
const WINDOW_MS = 60_000;
export const PUBLIC_RATE_LIMIT =
  Number(process.env.PUBLIC_RATE_LIMIT_PER_MIN) || 30;

const hits = new Map<string, number[]>();

function clientIp(req: Request): string {
  const direct = (req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '');
  const loopback = direct === '127.0.0.1' || direct === '::1';
  if (loopback) {
    const real = req.headers['x-real-ip'];
    if (typeof real === 'string' && real.trim()) return real.trim();
    // nginx $proxy_add_x_forwarded_for haqiqiy manzilni OXIRIGA qo'shadi; boshidagilarini mijoz yozgan bo'lishi mumkin
    const fwd = req.headers['x-forwarded-for'];
    const first = (Array.isArray(fwd) ? fwd.join(',') : fwd)
      ?.split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .pop();
    if (first) return first;
  }
  return direct || 'unknown';
}

@Injectable()
export class PublicRateLimitGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const ip = clientIp(req);
    const now = Date.now();
    const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
    if (list.length >= PUBLIC_RATE_LIMIT) {
      hits.set(ip, list);
      throw new HttpException(
        "Juda ko'p so'rov. Birozdan keyin urinib ko'ring",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    list.push(now);
    hits.set(ip, list);
    // xotira o'smasin: eski yozuvlar tozalanadi
    if (hits.size > 5000) {
      for (const [k, v] of hits) {
        if (!v.some((t) => now - t < WINDOW_MS)) hits.delete(k);
      }
    }
    return true;
  }
}
