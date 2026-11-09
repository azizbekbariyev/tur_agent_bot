import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** Login serveri ishlamasa (yoki javob bermasa) - amal rad etiladi, filial ma'lumoti o'zgarmaydi */
export const LOGIN_SERVER_DOWN =
  'Login serveri vaqtincha ishlamayapti, keyinroq urinib ko‘ring';

// SUPERADMIN | ADMIN | ACCOUNTANT | EMPLOYEE (login serveri tekshiradi)
type Role = string;

/**
 * Filial -> login serveri ichki API'si (Boshqaruv: xodim yaratish, o'zgartirish, parolni tiklash).
 * Kirish: OIDC client_id/secret (HTTP Basic). Rol qoidasi login serverida ham majburiy:
 * actorAccountId - amalni bajarayotgan adminning login serveridagi akkaunti.
 */
@Injectable()
export class LoginServerClient {
  private readonly logger = new Logger(LoginServerClient.name);

  constructor(private readonly configService: ConfigService) {}

  private settings() {
    const issuer = this.configService
      .get<string>('OIDC_ISSUER')
      ?.replace(/\/+$/, '');
    const clientId = this.configService.get<string>('OIDC_CLIENT_ID');
    const clientSecret = this.configService.get<string>('OIDC_CLIENT_SECRET');
    if (!issuer || !clientId || !clientSecret) return null;
    return { issuer, clientId, clientSecret };
  }

  /** Filial login serveriga ulanganmi (.env da OIDC_* bor) */
  enabled() {
    return !!this.settings();
  }

  private async call<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const s = this.settings();
    if (!s) throw new ServiceUnavailableException(LOGIN_SERVER_DOWN);
    let res: Response;
    try {
      res = await fetch(`${s.issuer}/internal${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          authorization: `Basic ${Buffer.from(
            `${encodeURIComponent(s.clientId)}:${encodeURIComponent(s.clientSecret)}`,
          ).toString('base64')}`,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'manual',
        signal: AbortSignal.timeout(8000),
      });
    } catch (error) {
      this.logger.error(`Login serveri javob bermadi: ${String(error)}`);
      throw new ServiceUnavailableException(LOGIN_SERVER_DOWN);
    }
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
    } & T;
    if (res.ok) return data;
    throw this.mapError(res.status, data?.error);
  }

  private mapError(status: number, code?: string): HttpException {
    this.logger.warn(`Login serveri rad etdi: ${status} ${code ?? ''}`);
    switch (code) {
      case 'username_taken':
        return new ConflictException('Bu username band');
      case 'account_blocked':
        return new ConflictException(
          'Xodim superadmin tomonidan barcha filiallarda bloklangan — blokni faqat superadmin ocha oladi',
        );
      case 'multi_branch_account':
        return new ConflictException(
          'Bu xodim bir nechta filialda ishlaydi: username’ni faqat Travance o‘zgartiradi',
        );
      case 'role_not_allowed':
        return new ForbiddenException(
          'Login serveri bu amalga ruxsat bermadi: admin faqat xodimlarni, superadmin admin/buxgalter/xodimlarni boshqaradi',
        );
      case 'actor_not_allowed':
        return new ForbiddenException(
          'Hisobingiz login serverida bu filial uchun faol emas. "Travance orqali kirish" bilan qayta kiring',
        );
      case 'self_not_allowed':
        return new ForbiddenException(
          'O‘zingizni bu yerda o‘zgartira olmaysiz',
        );
      case 'not_found':
        return new NotFoundException('Xodim login serverida topilmadi');
      case 'local_user_linked':
        return new ConflictException(
          'Bu xodim login serverida boshqa akkauntga bog‘langan',
        );
      case 'invalid_username':
        return new BadRequestException(
          'Username: lotin harflari, raqamlar, _ va . (3-30 belgi)',
        );
    }
    if (status >= 500 || status === 401) {
      // 401: filial kaliti mos emas - sozlama xatosi, foydalanuvchi uchun "ishlamayapti"
      return new ServiceUnavailableException(LOGIN_SERVER_DOWN);
    }
    return new BadRequestException('Login serveri so‘rovni rad etdi');
  }

  createAccount(input: {
    username: string;
    fullName: string;
    role: Role;
    status: 'active' | 'disabled';
    bcryptHash: string;
    localUserId: number;
    actorAccountId: string;
  }) {
    return this.call<{ accountId: string; username: string }>(
      'POST',
      '/accounts',
      input,
    );
  }

  updateAccount(
    accountId: string,
    input: {
      actorAccountId: string;
      role?: Role;
      status?: 'active' | 'disabled';
      username?: string;
    },
  ) {
    return this.call<{ ok: true }>(
      'PATCH',
      `/accounts/${encodeURIComponent(accountId)}`,
      input,
    );
  }

  /** O'chirish: faqat shu filialdagi a'zolik (oxirgisi bo'lsa akkaunt nofaol bo'ladi) */
  removeMembership(accountId: string, actorAccountId: string) {
    return this.call<{ ok: true; accountDeactivated: boolean }>(
      'DELETE',
      `/accounts/${encodeURIComponent(accountId)}/membership`,
      { actorAccountId },
    );
  }

  resetPassword(accountId: string, bcryptHash: string, actorAccountId: string) {
    return this.call<{ ok: true; pushTo: string[] }>(
      'POST',
      `/accounts/${encodeURIComponent(accountId)}/reset-password`,
      { bcryptHash, actorAccountId },
    );
  }
}
