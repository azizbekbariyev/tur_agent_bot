import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { type Request, type Response } from 'express';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { User } from '../bot/models/user';
import { UserSession } from '../bot/models/user_session';
import { AuthService } from './auth.service';
import { revokeUserSessions } from './sessions';
import { ROLES, frontendUrl } from '../common/roles';
import { localLoginEnabled } from '../common/flags';
import { isValidUsername, normalizeUsername } from '../common/username';

/**
 * Login serveri (login.travance.uz) orqali kirish: OpenID Connect, Authorization Code + PKCE.
 * Login serveri faqat kirish paytida kerak: tokenlar tekshirilgach filialning o'z sessiyasi
 * ochiladi (user_session, cookie) - login serveri to'xtasa ham ochiq sessiyalar ishlayveradi.
 *
 * .env: OIDC_ISSUER, OIDC_CLIENT_ID, OIDC_CLIENT_SECRET (uchalasi bo'lsa yoqiladi).
 * Qaytish manzili: FRONTEND_URL + /api/auth/oidc/callback (login serverida aynan shunday ro'yxatda).
 */

const TX_COOKIE = 'oidc_tx';
const TX_TTL_S = 10 * 60;
const BACKCHANNEL_EVENT = 'http://schemas.openid.net/event/backchannel-logout';
const PASSWORD_HASH_TYP = 'pwhash+jwt';
const ACCOUNT_STATUS_TYP = 'acctstatus+jwt';
const MEMBER_TYP = 'member+jwt';
// Superadmin paneli (5.3) tayinlay oladigan rollar: SUPERADMIN bu kanal orqali HECH QACHON o'rnatilmaydi
const PANEL_ROLES = ['ADMIN', 'ACCOUNTANT', 'EMPLOYEE'];
const BCRYPT_RE = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;

type Discovery = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  end_session_endpoint?: string;
};

type OidcTx = { state: string; nonce: string; verifier: string };

const b64url = (buf: Buffer) => buf.toString('base64url');
const randomToken = () => b64url(randomBytes(32));
const sameString = (a: string, b: string) => {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
};

/** Frontend kirish sahifasiga qaytish kodlari (Login.tsx ko'rsatadi) */
export type SsoError =
  | 'denied' // filialga a'zolik yo'q yoki bekor qilindi
  | 'not_linked' // login serveridagi akkaunt bu filialdagi xodimga bog'lanmagan
  | 'blocked' // filialda bloklangan / o'chirilgan
  | 'expired' // kirish oynasi eskirgan yoki boshqa tabda boshlangan
  | 'failed'; // login serveri javob bermadi yoki token noto'g'ri

@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private discovery: { value: Discovery; at: number } | null = null;
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  // Bir martalik server-server tokenlari (jti), 5 daqiqa eslab qolinadi
  private readonly seenJti = new Map<string, number>();

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserSession)
    private readonly sessionRepository: Repository<UserSession>,
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
    private readonly authService: AuthService,
  ) {}

  private settings() {
    const issuer = this.configService
      .get<string>('OIDC_ISSUER')
      ?.replace(/\/+$/, '');
    const clientId = this.configService.get<string>('OIDC_CLIENT_ID');
    const clientSecret = this.configService.get<string>('OIDC_CLIENT_SECRET');
    const base = frontendUrl();
    if (!issuer || !clientId || !clientSecret || !base) return null;
    return {
      issuer,
      clientId,
      clientSecret,
      base,
      redirectUri: `${base}/api/auth/oidc/callback`,
    };
  }

  private require() {
    const s = this.settings();
    if (!s) throw new NotFoundException();
    return s;
  }

  /** Frontend uchun: qaysi kirish usullari yoqilgan */
  publicConfig() {
    const s = this.settings();
    return {
      oidc: !!s,
      localLogin: localLoginEnabled(),
      // "Filialni almashtirish" tugmasi shu manzilga olib boradi
      switchUrl: s
        ? `${s.issuer}/select?from=${encodeURIComponent(s.clientId)}`
        : null,
      // Bog'langan xodim uchun "Parolni o'zgartirish" (yagona parol, K1/K2)
      passwordUrl: s
        ? `${s.issuer}/password?from=${encodeURIComponent(s.clientId)}`
        : null,
    };
  }

  /** fresh - keshni chetlab (kirish boshlanishida: login serveri hozir ishlayaptimi) */
  private async getDiscovery(fresh = false): Promise<Discovery> {
    const s = this.require();
    if (
      !fresh &&
      this.discovery &&
      Date.now() - this.discovery.at < 60 * 60 * 1000
    ) {
      return this.discovery.value;
    }
    const res = await fetch(`${s.issuer}/.well-known/openid-configuration`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) throw new Error(`discovery HTTP ${res.status}`);
    const value = (await res.json()) as Discovery;
    if (value.issuer !== s.issuer) {
      throw new Error('discovery: issuer mos emas');
    }
    this.discovery = { value, at: Date.now() };
    this.jwks ??= createRemoteJWKSet(new URL(value.jwks_uri), {
      timeoutDuration: 5000,
      cooldownDuration: 30_000,
      cacheMaxAge: 60 * 60 * 1000,
    });
    return value;
  }

  private async getJwks() {
    await this.getDiscovery();
    return this.jwks!;
  }

  private txSecret() {
    return `${this.configService.getOrThrow<string>('ACCESS_TOKEN_KEY')}:oidc-tx`;
  }

  private txCookieOptions() {
    const isProd = this.configService.get('NODE_ENV') === 'production';
    return {
      httpOnly: true,
      secure: isProd,
      sameSite: 'lax' as const,
      path: '/api/auth/oidc',
    };
  }

  private loginRedirect(res: Response, query: string) {
    const base = frontendUrl();
    res.redirect(303, `${base}/login?${query}`);
  }

  /** 1-qadam: brauzerni login serveriga yuborish (state, nonce, PKCE) */
  async start(res: Response) {
    const s = this.require();
    let d: Discovery;
    try {
      // Login serveri to'xtagan bo'lsa xodim brauzer xatosini emas, filial sahifasidagi xabarni ko'rsin
      d = await this.getDiscovery(true);
    } catch (error) {
      this.logger.error(`Login serveri javob bermadi: ${String(error)}`);
      return this.loginRedirect(res, 'sso_error=failed');
    }
    const tx: OidcTx = {
      state: randomToken(),
      nonce: randomToken(),
      verifier: randomToken(),
    };
    const token = await this.jwtService.signAsync(tx, {
      secret: this.txSecret(),
      expiresIn: TX_TTL_S,
    });
    res.cookie(TX_COOKIE, token, {
      ...this.txCookieOptions(),
      maxAge: TX_TTL_S * 1000,
    });
    const challenge = b64url(createHash('sha256').update(tx.verifier).digest());
    const url = new URL(d.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: s.clientId,
      redirect_uri: s.redirectUri,
      scope: 'openid profile',
      state: tx.state,
      nonce: tx.nonce,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    }).toString();
    res.redirect(302, url.toString());
  }

  /** 2-qadam: login serveridan qaytish - code ni tokenga almashtirish, tekshirish, sessiya */
  async callback(req: Request, res: Response) {
    const s = this.require();
    const q = req.query as Record<string, string | undefined>;
    const rawTx = (req.cookies as Record<string, string | undefined>)?.[
      TX_COOKIE
    ];
    res.clearCookie(TX_COOKIE, this.txCookieOptions());

    if (q.error) {
      const denied = q.error === 'access_denied';
      if (!denied) this.logger.warn(`Login serveri xatosi: ${q.error}`);
      return this.loginRedirect(
        res,
        `sso_error=${denied ? 'denied' : 'failed'}`,
      );
    }

    let tx: OidcTx;
    try {
      tx = await this.jwtService.verifyAsync<OidcTx>(rawTx ?? '', {
        secret: this.txSecret(),
      });
    } catch {
      return this.loginRedirect(res, 'sso_error=expired');
    }
    if (
      typeof q.state !== 'string' ||
      !sameString(q.state, tx.state) ||
      !q.code
    ) {
      return this.loginRedirect(res, 'sso_error=expired');
    }
    // RFC 9207: javob aynan bizning login serverimizdan
    if (q.iss !== undefined && q.iss !== s.issuer) {
      return this.loginRedirect(res, 'sso_error=failed');
    }

    let claims: JWTPayload & {
      nonce?: string;
      sid?: string;
      role?: string;
      azp?: string;
    };
    try {
      const d = await this.getDiscovery();
      const tokenRes = await fetch(d.token_endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${Buffer.from(
            `${encodeURIComponent(s.clientId)}:${encodeURIComponent(s.clientSecret)}`,
          ).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: q.code,
          redirect_uri: s.redirectUri,
          code_verifier: tx.verifier,
        }),
        redirect: 'manual',
        signal: AbortSignal.timeout(10_000),
      });
      if (!tokenRes.ok) throw new Error(`token HTTP ${tokenRes.status}`);
      const body = (await tokenRes.json()) as { id_token?: string };
      if (!body.id_token) throw new Error("id_token yo'q");
      const verified = await jwtVerify(body.id_token, await this.getJwks(), {
        issuer: s.issuer,
        audience: s.clientId,
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'exp', 'iat'],
      });
      claims = verified.payload;
      if (!claims.nonce || !sameString(String(claims.nonce), tx.nonce)) {
        throw new Error('nonce mos emas');
      }
      if (claims.azp !== undefined && claims.azp !== s.clientId) {
        throw new Error('azp mos emas');
      }
    } catch (error) {
      this.logger.error(`Login serveri orqali kirish xatosi: ${String(error)}`);
      return this.loginRedirect(res, 'sso_error=failed');
    }

    // Rol login serveridagi a'zolikdan. A'zolik bo'lmasa rol kelmaydi - kirish yo'q.
    const role = claims.role;
    if (!role || !(ROLES as readonly string[]).includes(role)) {
      return this.loginRedirect(res, 'sso_error=denied');
    }

    const user = await this.userRepository.findOne({
      where: { accountId: String(claims.sub) },
    });
    if (!user) {
      this.logger.warn(`Bog'lanmagan akkaunt: ${String(claims.sub)}`);
      return this.loginRedirect(res, 'sso_error=not_linked');
    }
    if (user.isDeleted || !user.status) {
      return this.loginRedirect(res, 'sso_error=blocked');
    }
    if (user.type !== role) {
      this.logger.log(
        `Rol login serveridan yangilandi: user ${user.id} ${user.type} -> ${role}`,
      );
      await this.userRepository.update({ id: user.id }, { type: role });
      user.type = role;
    }

    const oidcSid =
      typeof claims.sid === 'string' ? claims.sid.slice(0, 128) : null;
    await this.authService.openSession(user, req, res, oidcSid);
    return this.loginRedirect(res, 'sso=ok');
  }

  /** Chiqish: login serveridan ham (barcha filiallar) - keyin filial kirish sahifasiga qaytadi */
  async logoutRedirect(res: Response) {
    const s = this.require();
    try {
      const d = await this.getDiscovery();
      if (!d.end_session_endpoint) throw new Error("end_session_endpoint yo'q");
      const url = new URL(d.end_session_endpoint);
      url.search = new URLSearchParams({
        client_id: s.clientId,
        post_logout_redirect_uri: `${s.base}/login`,
      }).toString();
      res.redirect(302, url.toString());
    } catch (error) {
      this.logger.warn(`Login serveridan chiqarib bo'lmadi: ${String(error)}`);
      this.loginRedirect(res, 'logout=local');
    }
  }

  /**
   * Login serveri -> filial ichki so'rovi (masalan, Superadmin paneli statistikasi).
   * `Authorization: Bearer <JWT>`: RS256 (login serverining JWKS), iss = login serveri,
   * aud = shu filial, typ aniq, 60 soniyadan eski emas, jti bir martalik.
   * Har qanday xato - 401 (sababi javobda aytilmaydi, faqat logda).
   */
  async verifyServiceToken(authorization: unknown, typ: string) {
    const s = this.settings();
    const token =
      typeof authorization === 'string' && authorization.startsWith('Bearer ')
        ? authorization.slice(7).trim()
        : '';
    if (!s || !token) throw new UnauthorizedException();
    let payload: JWTPayload;
    try {
      ({ payload } = await jwtVerify(token, await this.getJwks(), {
        issuer: s.issuer,
        audience: s.clientId,
        algorithms: ['RS256'],
        typ,
        maxTokenAge: '60s',
        requiredClaims: ['jti', 'iat', 'exp'],
      }));
      // Uzoq muddatli token qabul qilinmaydi (imzolovchi xato qilsa ham)
      if (Number(payload.exp) - Number(payload.iat) > 60) {
        throw new Error('muddat 60 soniyadan uzun');
      }
    } catch (error) {
      this.logger.warn(`Ichki so'rov rad etildi (${typ}): ${String(error)}`);
      throw new UnauthorizedException();
    }
    if (!this.rememberJti(payload.jti)) {
      this.logger.warn(
        `Ichki so'rov rad etildi (${typ}): jti qayta ishlatilgan`,
      );
      throw new UnauthorizedException();
    }
    return payload;
  }

  private rememberJti(jti: unknown) {
    const now = Date.now();
    for (const [k, exp] of this.seenJti) if (exp < now) this.seenJti.delete(k);
    if (typeof jti !== 'string' || !jti || this.seenJti.has(jti)) return false;
    this.seenJti.set(jti, now + 5 * 60 * 1000);
    return true;
  }

  /**
   * Back-channel logout (OIDC): login serverida chiqilganda yoki akkaunt/a'zolik o'chirilganda.
   * sid bo'lsa - o'sha kirish sessiyalari, faqat sub bo'lsa - shu odamning barcha sessiyalari.
   */
  async backchannelLogout(logoutToken: unknown) {
    const s = this.require();
    if (typeof logoutToken !== 'string' || !logoutToken) {
      throw new BadRequestException('logout_token kerak');
    }
    let payload: JWTPayload & {
      sid?: string;
      events?: Record<string, unknown>;
      nonce?: unknown;
    };
    try {
      ({ payload } = await jwtVerify(logoutToken, await this.getJwks(), {
        issuer: s.issuer,
        audience: s.clientId,
        algorithms: ['RS256'],
        maxTokenAge: '5m',
        requiredClaims: ['iat', 'jti'],
      }));
    } catch (error) {
      this.logger.warn(`Noto'g'ri logout_token: ${String(error)}`);
      throw new BadRequestException('logout_token yaroqsiz');
    }
    if (
      !payload.events ||
      typeof payload.events[BACKCHANNEL_EVENT] !== 'object' ||
      payload.nonce !== undefined ||
      (!payload.sid && !payload.sub)
    ) {
      throw new BadRequestException('logout_token yaroqsiz');
    }
    this.rememberJti(payload.jti);

    if (payload.sid) {
      const result = await this.sessionRepository
        .createQueryBuilder()
        .update()
        .set({ revokedAt: new Date() })
        .where('oidc_sid = :sid AND revoked_at IS NULL', { sid: payload.sid })
        .execute();
      this.logger.log(
        `Back-channel logout (sid): ${result.affected ?? 0} sessiya yopildi`,
      );
      return;
    }
    const user = await this.userRepository.findOne({
      where: { accountId: String(payload.sub) },
    });
    if (user) {
      await revokeUserSessions(this.sessionRepository, user.id);
      this.logger.log(
        `Back-channel logout (akkaunt): user ${user.id} sessiyalari yopildi`,
      );
    }
  }

  /**
   * Akkaunt holati (superadmin barcha filiallarda bloklasa / blokdan chiqarsa): filialdagi
   * user.status o'zgaradi - zaxira kirish ham yopiladi. Imzolangan server-server so'rovi
   * (RS256, aud = shu filial, 2 daqiqa, jti bir martalik).
   */
  async receiveAccountStatus(token: unknown) {
    const s = this.require();
    if (typeof token !== 'string' || !token) {
      throw new BadRequestException('token kerak');
    }
    let payload: JWTPayload & { active?: unknown };
    try {
      ({ payload } = await jwtVerify(token, await this.getJwks(), {
        issuer: s.issuer,
        audience: s.clientId,
        algorithms: ['RS256'],
        typ: ACCOUNT_STATUS_TYP,
        maxTokenAge: '120s',
        requiredClaims: ['sub', 'jti', 'iat', 'exp'],
      }));
    } catch (error) {
      this.logger.warn(`Noto'g'ri holat so'rovi: ${String(error)}`);
      throw new BadRequestException('token yaroqsiz');
    }
    if (typeof payload.active !== 'boolean') {
      throw new BadRequestException('token yaroqsiz');
    }
    if (!this.rememberJti(payload.jti)) {
      throw new BadRequestException('token allaqachon ishlatilgan');
    }
    const user = await this.userRepository.findOne({
      where: { accountId: String(payload.sub) },
    });
    if (!user) throw new NotFoundException();
    if (user.isDeleted) return;
    await this.userRepository.update(
      { id: user.id },
      { status: payload.active },
    );
    if (!payload.active) {
      await revokeUserSessions(this.sessionRepository, user.id);
    }
    this.logger.log(
      `Akkaunt holati login serveridan: user ${user.id} -> ${payload.active ? 'faol' : 'bloklangan'}`,
    );
  }

  /**
   * A'zolik (5.3, Superadmin paneli): login serveri xodimni shu filialga qo'shganda, rolini
   * o'zgartirganda, filialdan uzganda yoki bloklaganda. Imzolangan server-server so'rovi
   * (RS256, typ member+jwt, aud = shu filial, 2 daqiqa, jti bir martalik).
   * - user qatori yo'q va faol: yangi qator (parolsiz; zaxira parol keyin password-hash bilan keladi).
   * - bor: rol va holat yangilanadi; o'chirilgan bo'lsa va qayta ulansa - tiklanadi.
   * - rol o'zgarsa yoki faolsizlansa - barcha seanslari yopiladi (yangi huquq bilan qayta kiradi).
   * SUPERADMIN qatoriga bu kanal tegmaydi va SUPERADMIN rolini o'rnatmaydi.
   */
  async receiveMember(token: unknown): Promise<{ userId: number | null }> {
    const s = this.require();
    if (typeof token !== 'string' || !token) {
      throw new BadRequestException('token kerak');
    }
    let payload: JWTPayload & {
      role?: unknown;
      active?: unknown;
      username?: unknown;
      name?: unknown;
    };
    try {
      ({ payload } = await jwtVerify(token, await this.getJwks(), {
        issuer: s.issuer,
        audience: s.clientId,
        algorithms: ['RS256'],
        typ: MEMBER_TYP,
        maxTokenAge: '120s',
        requiredClaims: ['sub', 'jti', 'iat', 'exp'],
      }));
    } catch (error) {
      this.logger.warn(`Noto'g'ri a'zolik so'rovi: ${String(error)}`);
      throw new BadRequestException('token yaroqsiz');
    }
    const role = payload.role === null ? null : payload.role;
    const username =
      typeof payload.username === 'string'
        ? normalizeUsername(payload.username)
        : '';
    const name =
      typeof payload.name === 'string' ? payload.name.trim().slice(0, 120) : '';
    if (
      typeof payload.active !== 'boolean' ||
      (role !== null && !PANEL_ROLES.includes(String(role))) ||
      !isValidUsername(username)
    ) {
      throw new BadRequestException('token yaroqsiz');
    }
    if (!this.rememberJti(payload.jti)) {
      throw new BadRequestException('token allaqachon ishlatilgan');
    }
    const accountId = String(payload.sub);
    const active = payload.active && role !== null;
    const user = await this.userRepository.findOne({ where: { accountId } });

    if (!user) {
      if (!active) return { userId: null };
      const taken = await this.userRepository
        .createQueryBuilder('u')
        .where('lower(u.username) = :username', { username })
        .getOne();
      if (taken) {
        this.logger.warn(
          `A'zolik: username band (${username}) - filialdagi user ${taken.id}`,
        );
        throw new ConflictException('username band');
      }
      const [first, ...rest] = (name || username).split(/\s+/);
      const saved = await this.userRepository.save(
        this.userRepository.create({
          firstName: first,
          lastName: rest.join(' ') || undefined,
          username,
          accountId,
          type: String(role),
          status: true,
          hashedPassword: '',
        }),
      );
      this.logger.log(
        `A'zolik login serveridan: yangi user ${saved.id} (${String(role)})`,
      );
      return { userId: saved.id };
    }

    if (user.type === 'SUPERADMIN') {
      this.logger.warn(`A'zolik: SUPERADMIN user ${user.id} ga tegilmaydi`);
      throw new ForbiddenException();
    }
    const patch: Partial<User> = { status: active };
    if (role !== null && user.type !== role) patch.type = String(role);
    if (active && user.isDeleted) patch.isDeleted = false;
    await this.userRepository.update({ id: user.id }, patch);
    if (!active || patch.type !== undefined) {
      await revokeUserSessions(this.sessionRepository, user.id);
    }
    this.logger.log(
      `A'zolik login serveridan: user ${user.id} -> ${active ? 'faol' : 'nofaol'}${patch.type ? `, rol ${user.type} -> ${patch.type}` : ''}${patch.isDeleted === false ? ', tiklandi' : ''}`,
    );
    return { userId: user.id };
  }

  /**
   * Zaxira kirish paroli (A variant): login serverida yagona parol o'zgarganda bcrypt hash keladi.
   * Faqat imzolangan server-server so'rovi: RS256 (login serverining JWKS), aud = shu filial,
   * 2 daqiqa amal qiladi, jti bir martalik. Ochiq parol hech qachon kelmaydi.
   */
  async receivePasswordHash(token: unknown) {
    const s = this.require();
    if (typeof token !== 'string' || !token) {
      throw new BadRequestException('token kerak');
    }
    let payload: JWTPayload & { pwh?: unknown };
    try {
      ({ payload } = await jwtVerify(token, await this.getJwks(), {
        issuer: s.issuer,
        audience: s.clientId,
        algorithms: ['RS256'],
        typ: PASSWORD_HASH_TYP,
        maxTokenAge: '120s',
        requiredClaims: ['sub', 'jti', 'iat', 'exp'],
      }));
    } catch (error) {
      this.logger.warn(`Noto'g'ri parol hash so'rovi: ${String(error)}`);
      throw new BadRequestException('token yaroqsiz');
    }
    if (typeof payload.pwh !== 'string' || !BCRYPT_RE.test(payload.pwh)) {
      throw new BadRequestException('token yaroqsiz');
    }
    if (!this.rememberJti(payload.jti)) {
      throw new BadRequestException('token allaqachon ishlatilgan');
    }
    const user = await this.userRepository.findOne({
      where: { accountId: String(payload.sub) },
    });
    if (!user) throw new NotFoundException();
    // O'chirilgan xodimning parolini yangilash shart emas
    if (user.isDeleted) return;
    await this.userRepository.update(
      { id: user.id },
      { hashedPassword: payload.pwh },
    );
    this.logger.log(`Zaxira kirish paroli yangilandi: user ${user.id}`);
  }
}
