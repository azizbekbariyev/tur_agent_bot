import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import ExcelJS from 'exceljs';
import { randomBytes } from 'crypto';
import { DataSource, DeepPartial, EntityManager, Repository } from 'typeorm';
import { Cash } from '../bot/models/cash';
import { Contract } from '../bot/models/contract';
import { ContractFlight } from '../bot/models/contract_flight';
import { ContractHotel } from '../bot/models/contract_hotel';
import { ContractExtra } from '../bot/models/contract_extra';
import { ContractVersion } from '../bot/models/contract_version';
import { CashServiceContractLink } from '../bot/models/cash_service_contract_link';
import { History } from '../bot/models/history';
import { InstallmentProvider } from '../bot/models/installment_provider';
import { CashService } from '../cash/cash.service';
import { CashStatus, CreateCashDto } from '../cash/dto/cash.dto';
import {
  DEBT_THRESHOLD,
  formatSeqNo,
  hasContractNumber,
} from '../cash/cash.utils';
import { SettingsService } from '../settings/settings.service';
import { BotService } from '../bot/bot.service';
import { Passenger } from '../bot/models/passenger';
import {
  buildReceiptModel,
  maskClientName,
  maskPhone,
  ReceiptInput,
  ReceiptLang,
} from './receipt-model';
import { multiCitySample } from './receipt-samples';
import {
  ReceiptTooLongError,
  TOO_LONG_MESSAGE,
  receiptFits,
  renderReceiptPdf,
} from './receipt-pdf';
import { isDrawableLogo } from './receipt-logo';
import { receiptQrPng } from './receipt-qr';
import { canViewAll } from '../common/roles';
import { escapeLike } from '../common/text';
import { tashkentDate } from '../common/date';
import { UserReq } from '../types/user.type';
import { checkContract, CheckInput, nightsBetween } from './contract-check';
import { applyDraft } from './contract-preview';
import {
  ContractBundle,
  ContractContent,
  ContractSnapshot,
  buildContent,
  snapshotToReceiptInput,
  buildPayments,
  buildSnapshot,
  cashDay,
  cashServiceLabel,
  checkServices,
  contentHash,
  latestVersion,
  loadContractBundle,
  toCheckInput,
} from './contract-data';
import { allocateContractNumber, peekContractNumber } from './contract-number';
import { markChangedIfDiffers, setContractStatus } from './contract-hooks';
import {
  CheckPreviewDto,
  ContractBodyDto,
  ContractExportQueryDto,
  ContractListQueryDto,
  HotelNamesQueryDto,
  ExtraRowDto,
  FlightRowDto,
  HotelRowDto,
  CreateContractForCashDto,
  CreateContractWithCashDto,
  CreateProviderDto,
  IssueContractDto,
  ReceiptPreviewDto,
  SendContractTelegramDto,
  TemplateFitDto,
  RoomsSeparateDto,
  SetServiceLinksDto,
  UpdateProviderDto,
} from './contracts.dto';

/* ------------------------------ rollar (docs/shartnoma.md, 1- va 4-qism) ------------------------------ */
// Xodim - o'z kassalari (egasi yoki qo'shimcha xodim, kassa ko'rinish qoidasi bilan bir xil);
// Admin - filialning hammasi; Buxgalter - faqat o'qish (+ oxirgi berilgan versiya);
// Superadmin - bu bo'lim yo'q.

function requireReader(user: UserReq) {
  if (!['EMPLOYEE', 'ADMIN', 'ACCOUNTANT'].includes(user.role)) {
    throw new ForbiddenException("Shartnoma bo'limi bu rol uchun yo'q");
  }
}
function requireWriter(user: UserReq) {
  if (!['EMPLOYEE', 'ADMIN'].includes(user.role)) {
    throw new ForbiddenException('Ruxsat yo‘q');
  }
}
/** Sozlamalar (provayderlar) - faqat filial admini (superadmin uchun bu bo'lim yo'q) */
function requireBranchAdmin(user: UserReq) {
  if (user.role !== 'ADMIN') throw new ForbiddenException('Ruxsat yo‘q');
}
const isParticipant = (cash: Cash, userId: number) =>
  cash.user?.id === userId || cash.additionalUser?.id === userId;

const EDITABLE_CASH = (status: string) => status !== 'cancelled';

@Injectable()
export class ContractsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly cashService: CashService,
    private readonly settingsService: SettingsService,
    private readonly botService: BotService,
    @InjectRepository(Contract)
    private readonly contractRepo: Repository<Contract>,
    @InjectRepository(InstallmentProvider)
    private readonly providerRepo: Repository<InstallmentProvider>,
  ) {}

  /* ================================ yordamchilar ================================ */

  /** Ko'rinadigan kassa (o'chirilmagan); aks holda 404 */
  private async visibleCash(
    manager: EntityManager,
    user: UserReq,
    cashId: number,
  ) {
    const cash = await manager.getRepository(Cash).findOne({
      where: { id: cashId, isDeleted: false },
      relations: { user: true, additionalUser: true, brutto: true },
    });
    if (!cash || (!canViewAll(user.role) && !isParticipant(cash, user.id))) {
      throw new NotFoundException('Kassa topilmadi');
    }
    return cash;
  }

  /** Ko'rinadigan shartnoma to'plami; lock - tahrirlash uchun shartnoma qatori qulflanadi */
  private async visibleBundle(
    manager: EntityManager,
    user: UserReq,
    where: { contractId: number } | { cashId: number },
    lock = false,
  ): Promise<ContractBundle> {
    if (lock && 'contractId' in where) {
      await manager.query(
        `SELECT 1 FROM "contracts" WHERE "id" = $1 FOR UPDATE`,
        [where.contractId],
      );
    }
    const b = await loadContractBundle(manager, where);
    if (
      !b ||
      b.cash.isDeleted ||
      (!canViewAll(user.role) && !isParticipant(b.cash, user.id))
    ) {
      throw new NotFoundException('Shartnoma topilmadi');
    }
    return b;
  }

  private history(
    manager: EntityManager,
    user: UserReq,
    cashId: number,
    name: string,
    newValue: string,
    oldValue = '',
  ) {
    return manager.getRepository(History).save({
      name,
      old_column: oldValue,
      new_column: newValue,
      user: { id: user.id },
      cash: { id: cashId },
    });
  }

  /**
   * Tur tarkibi qatorlarini yozadi. id bor - joyida yangilanadi (bog'lanishlar saqlanadi), id yo'q - yangi,
   * ro'yxatda yo'q - o'chadi (bog'lanishlari ham - ON DELETE CASCADE). Ro'yxat berilmasa - tegilmaydi.
   */
  private async writeRows(
    manager: EntityManager,
    contractId: number,
    dto: ContractBodyDto,
    existing?: Pick<
      ContractBundle['contract'],
      'flights' | 'hotels' | 'extras'
    >,
  ) {
    const sync = async <
      E extends { id: number; contractId: number; position: number },
      R extends { id?: number },
    >(
      repo: Repository<E>,
      rows: R[] | undefined,
      current: E[],
      map: (r: R) => DeepPartial<E>,
      what: string,
    ) => {
      if (!rows) return;
      const keep = new Set<number>();
      for (const [position, r] of rows.entries()) {
        if (r.id && !current.some((c) => c.id === r.id)) {
          throw new BadRequestException(`${what} #${r.id} bu shartnomada yo'q`);
        }
        if (r.id) keep.add(r.id);
        await repo.save(
          repo.create({
            ...map(r),
            ...(r.id ? { id: r.id } : {}),
            contractId,
            position,
          } as DeepPartial<E>),
        );
      }
      const remove = current.filter((c) => !keep.has(c.id)).map((c) => c.id);
      if (remove.length) await repo.delete(remove);
    };

    await sync<ContractFlight, FlightRowDto>(
      manager.getRepository(ContractFlight),
      dto.flights,
      existing?.flights ?? [],
      (r) => ({
        fromCity: r.fromCity,
        toCity: r.toCity,
        transitCity: r.transitCity ?? null,
        date: r.date ?? null,
        airline: r.airline ?? null,
        baggageType: r.baggageType ?? null,
        baggagePaxCount: r.baggagePaxCount ?? 0,
      }),
      'Parvoz',
    );
    for (const h of dto.hotels ?? []) {
      if (h.checkIn && h.checkOut && h.checkOut <= h.checkIn) {
        throw new BadRequestException(
          `Mehmonxona (${h.city}): chiqish sanasi kirishdan keyin bo'lishi kerak`,
        );
      }
    }
    await sync<ContractHotel, HotelRowDto>(
      manager.getRepository(ContractHotel),
      dto.hotels,
      existing?.hotels ?? [],
      (r) => {
        const transferType = r.transferType ?? 'none';
        return {
          city: r.city,
          name: r.name ?? null,
          stars: r.stars ?? null,
          roomType: r.roomType ?? null,
          placement: r.placement ?? null,
          roomsCount: r.roomsCount ?? 1,
          meal: r.meal ?? null,
          checkIn: r.checkIn ?? null,
          checkOut: r.checkOut ?? null,
          transferType,
          transferRoute:
            transferType === 'none' ? null : (r.transferRoute ?? 'full'),
        };
      },
      'Mehmonxona',
    );
    await sync<ContractExtra, ExtraRowDto>(
      manager.getRepository(ContractExtra),
      dto.extras,
      existing?.extras ?? [],
      (r) => {
        const paymentMode = r.paymentMode ?? 'included';
        return {
          name: r.name,
          city: r.city ?? null,
          date: r.date ?? null,
          pax: r.pax ?? null,
          paymentMode,
          priceUsd:
            paymentMode === 'separate' && r.priceUsd != null
              ? Number(r.priceUsd).toFixed(2)
              : null,
        };
      },
      "Qo'shimcha xizmat",
    );
  }

  private async insertContract(
    manager: EntityManager,
    user: UserReq,
    cashId: number,
    number: string,
    dto: ContractBodyDto,
  ) {
    const settings = await this.settingsService.get();
    const saved = await manager.getRepository(Contract).save({
      cashId,
      number,
      status: 'draft',
      currentVersion: 0,
      lang: dto.lang ?? settings.contract.receiptLang,
      insurance: dto.insurance ?? 'not_included',
      visa: dto.visa ?? 'not_included',
      // QR ochiq sahifa kaliti: 32 bayt tasodifiy (taxmin qilib bo'lmaydi)
      publicToken: randomBytes(32).toString('base64url'),
      createdBy: { id: user.id },
    });
    await this.writeRows(manager, saved.id, dto);
    return saved;
  }

  /* ================================ o'qish ================================ */

  /** Kassa sahifasi va shartnoma sahifasi uchun to'liq ko'rinish */
  private async view(manager: EntityManager, user: UserReq, b: ContractBundle) {
    const { contract: c, cash } = b;
    const allVersions = await manager.getRepository(ContractVersion).find({
      where: { contractId: c.id },
      relations: { issuedBy: true },
      order: { version: 'ASC' },
    });
    const last = allVersions[allVersions.length - 1];
    // Buxgalter faqat oxirgi berilgan versiyani ko'radi
    const versions = user.role === 'ACCOUNTANT' && last ? [last] : allVersions;
    const hashNow = contentHash(buildContent(b));
    const first = cash.passengers?.[0];
    const writer =
      ['EMPLOYEE', 'ADMIN'].includes(user.role) && EDITABLE_CASH(cash.status);
    const editable = writer && c.status !== 'cancelled';
    return {
      contract: {
        id: c.id,
        cashId: c.cashId,
        number: c.number,
        status: c.status,
        currentVersion: c.currentVersion,
        lang: c.lang,
        insurance: c.insurance,
        visa: c.visa,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt,
        createdBy: c.createdBy
          ? {
              id: c.createdBy.id,
              firstName: c.createdBy.firstName,
              lastName: c.createdBy.lastName ?? null,
            }
          : null,
      },
      flights: c.flights,
      hotels: c.hotels.map((h) => ({
        ...h,
        nights: nightsBetween(h.checkIn, h.checkOut),
      })),
      extras: c.extras.map((e) => ({
        ...e,
        priceUsd: e.priceUsd === null ? null : Number(e.priceUsd),
      })),
      // Qulflangan karta: kassadan (shartnoma bu yerda faqat o'qiydi)
      cash: {
        id: cash.id,
        seqNo: cash.seq_no,
        idLabel: formatSeqNo(cash.seq_no),
        status: cash.status,
        destination: cash.destination,
        departureDate: cashDay(cash.departure_date),
        returnDate: cashDay(cash.return_date),
        tourNights: nightsBetween(
          cashDay(cash.departure_date),
          cashDay(cash.return_date),
        ),
        tourists: cash.turist_count,
        // kassa sanasi (tur sotilgan kun) - kvitansiyadagi «Курс на …»
        saleDate: cashDay(cash.created_at as unknown as string),
        client: first
          ? {
              firstName: first.firstName,
              lastName: first.lastName ?? null,
              phone: first.phoneNumber ?? null,
            }
          : null,
        brutto: cash.brutto
          ? {
              amount: Number(cash.brutto.amount),
              currency: cash.brutto.currency,
              rate: Number(cash.brutto.currency_amount),
            }
          : null,
        ...buildPayments(cash),
      },
      services: checkServices(b).map((s) => {
        const cs = cash.cashServices.find((x) => x.id === s.id)!;
        return {
          id: s.id,
          typeKey: s.typeKey,
          typeName: cs.service?.serviceType?.name ?? null,
          label: cashServiceLabel(cs),
          links: b.links
            .filter((l) => l.cashServiceId === s.id)
            .map((l) => ({
              type: l.itemType,
              id: l.flightId ?? l.hotelId ?? l.extraId ?? null,
            })),
        };
      }),
      check: checkContract(toCheckInput(b)),
      versions: versions.map((v) => ({
        version: v.version,
        issuedAt: v.issuedAt,
        channel: v.channel,
        issuedBy: v.issuedBy
          ? {
              id: v.issuedBy.id,
              firstName: v.issuedBy.firstName,
              lastName: v.issuedBy.lastName ?? null,
            }
          : null,
      })),
      // Oxirgi berilgan versiyadan keyin kvitansiya mazmuni o'zgarganmi (yangi chop etish = yangi versiya)
      changedSinceIssue: last
        ? (last.snapshot as { contentHash?: string }).contentHash !== hashNow
        : null,
      permissions: {
        canEdit: editable,
        canIssue: editable,
        canSign: editable && c.status === 'issued',
        canLink: editable,
        canDownloadLatest: !!last,
      },
    };
  }

  async getByCash(user: UserReq, cashId: number) {
    requireReader(user);
    const m = this.dataSource.manager;
    await this.visibleCash(m, user, cashId);
    const b = await loadContractBundle(m, { cashId });
    if (!b) return { contract: null };
    return this.view(m, user, b);
  }

  async get(user: UserReq, id: number) {
    requireReader(user);
    const m = this.dataSource.manager;
    return this.view(
      m,
      user,
      await this.visibleBundle(m, user, { contractId: id }),
    );
  }

  /** Shartnomalar ro'yxati (dizayn 3): qidiruv, filtrlar, qoldiq */
  async list(user: UserReq, q: ContractListQueryDto) {
    requireReader(user);
    const qb = this.contractRepo
      .createQueryBuilder('ct')
      .innerJoinAndSelect('ct.cash', 'c')
      .leftJoinAndSelect('c.brutto', 'b')
      .leftJoinAndSelect('c.moneys', 'm')
      .leftJoinAndSelect('c.passengers', 'p')
      .leftJoinAndSelect('c.user', 'u')
      .leftJoinAndSelect('c.additionalUser', 'au')
      .where('c.is_deleted = false');
    if (!canViewAll(user.role)) {
      qb.andWhere('(c.user_id = :uid OR c.additional_user = :uid)', {
        uid: user.id,
      });
    }
    // Dogovor sanasi oralig'i (Toshkent kuni)
    if (q.from) {
      qb.andWhere(
        `(ct.created_at AT TIME ZONE 'Asia/Tashkent')::date >= :from`,
        { from: q.from },
      );
    }
    if (q.to) {
      qb.andWhere(`(ct.created_at AT TIME ZONE 'Asia/Tashkent')::date <= :to`, {
        to: q.to,
      });
    }
    const search = q.search?.trim();
    if (search) {
      qb.andWhere(
        `(ct.number ILIKE :s OR c.destination ILIKE :s OR EXISTS (
            SELECT 1 FROM passenger ps WHERE ps."cashId" = c.id AND (
              ps.first_name ILIKE :s OR ps.last_name ILIKE :s OR ps.phone_number ILIKE :s
              OR CONCAT(ps.last_name, ' ', ps.first_name) ILIKE :s
              OR CONCAT(ps.first_name, ' ', ps.last_name) ILIKE :s)))`,
        { s: `%${escapeLike(search)}%` },
      );
    }
    qb.orderBy('ct.id', 'DESC');
    const all = await qb.getMany();

    const rows = all.map((ct) => {
      const cash = ct.cash;
      cash.passengers?.sort((a, b) => a.id - b.id);
      const first = cash.passengers?.[0];
      const pay = buildPayments(cash);
      return {
        id: ct.id,
        cashId: cash.id,
        idLabel: formatSeqNo(cash.seq_no),
        number: ct.number,
        createdAt: ct.createdAt,
        contractDate: tashkentDate(ct.createdAt) || null,
        status: ct.status,
        currentVersion: ct.currentVersion,
        client: first
          ? `${first.lastName ?? ''} ${first.firstName ?? ''}`.trim()
          : null,
        phone: first?.phoneNumber ?? null,
        destination: cash.destination,
        departureDate: cashDay(cash.departure_date),
        returnDate: cashDay(cash.return_date),
        price: cash.brutto
          ? {
              amount: Number(cash.brutto.amount),
              currency: cash.brutto.currency,
            }
          : null,
        ...pay,
        hasDebt: pay.debtUzs > DEBT_THRESHOLD && cash.status !== 'cancelled',
        // xodim ustuni - faqat admin/buxgalter uchun (xodim faqat o'z kassalarini ko'radi)
        employee:
          canViewAll(user.role) && cash.user
            ? `${cash.user.firstName} ${cash.user.lastName ?? ''}`.trim()
            : null,
        cashStatus: cash.status,
      };
    });

    const counts = {
      ALL: rows.length,
      draft: 0,
      issued: 0,
      signed: 0,
      changed: 0,
      cancelled: 0,
      debt: rows.filter((r) => r.hasDebt).length,
    } as Record<string, number>;
    for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;

    const status = q.status && q.status !== 'ALL' ? q.status : null;
    const filtered = !status
      ? rows
      : status === 'debt'
        ? rows.filter((r) => r.hasDebt)
        : rows.filter((r) => r.status === status);
    const limit = q.limit ?? 50;
    const page = q.page ?? 1;
    return {
      items: filtered.slice((page - 1) * limit, page * limit),
      total: filtered.length,
      page,
      limit,
      counts,
    };
  }

  /** «Excel'ga yuklash»: joriy filtr va qidiruv bo'yicha (xodim - faqat o'z kassalari) */
  async exportList(user: UserReq, q: ContractExportQueryDto) {
    const res = await this.list(user, { ...q, page: 1, limit: 100_000 });
    const ru = q.lang === 'ru';
    const L = (uz: string, r: string) => (ru ? r : uz);
    const statusName: Record<string, string> = {
      draft: L('Qoralama', 'Черновик'),
      issued: L('Berilgan', 'Выдан'),
      signed: L('Imzolangan', 'Подписан'),
      changed: L("O'zgargan — qayta imzo", 'Изменён — повторная подпись'),
      cancelled: L('Bekor qilingan', 'Отменён'),
    };
    const wb = new ExcelJS.Workbook();
    const sheet = wb.addWorksheet(L('Shartnomalar', 'Договоры'));
    const viewAll = canViewAll(user.role);
    sheet.columns = [
      { header: L('Dogovor №', 'Договор №'), key: 'number', width: 12 },
      { header: L('Sana', 'Дата'), key: 'date', width: 12 },
      { header: L('Mijoz', 'Клиент'), key: 'client', width: 28 },
      { header: L('Telefon', 'Телефон'), key: 'phone', width: 16 },
      { header: L("Yo'nalish", 'Направление'), key: 'destination', width: 28 },
      { header: L('Uchish', 'Вылет'), key: 'dep', width: 12 },
      { header: L('Qaytish', 'Возвращение'), key: 'ret', width: 12 },
      { header: L('Narx', 'Цена'), key: 'price', width: 12 },
      { header: L('Valyuta', 'Валюта'), key: 'currency', width: 8 },
      { header: L("Qoldiq, so'm", 'Остаток, сум'), key: 'debtUzs', width: 14 },
      {
        header: L('Qoldiq (valyutada)', 'Остаток (в валюте)'),
        key: 'debtCur',
        width: 14,
      },
      ...(viewAll
        ? [{ header: L('Xodim', 'Сотрудник'), key: 'employee', width: 22 }]
        : []),
      { header: L('Holat', 'Статус'), key: 'status', width: 22 },
      { header: L('Versiya', 'Версия'), key: 'version', width: 8 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of res.items) {
      sheet.addRow({
        number: r.number,
        date: r.contractDate,
        client: r.client,
        phone: r.phone,
        destination: r.destination,
        dep: r.departureDate,
        ret: r.returnDate,
        price: r.price?.amount ?? null,
        currency: r.price?.currency ?? null,
        debtUzs: r.debtUzs,
        debtCur: r.debtInCurrency,
        employee: r.employee,
        status: statusName[r.status] ?? r.status,
        version: r.currentVersion ? `v${r.currentVersion}` : '',
      });
    }
    const today = tashkentDate(new Date());
    return {
      buffer: Buffer.from(await wb.xlsx.writeBuffer()),
      filename: `shartnomalar-${today}.xlsx`,
    };
  }

  /**
   * Sozlamalar: yangi ogohlantirish/shartlar matni bilan STANDART 4+4+2 tur kvitansiyasi bitta sahifaga sig'adimi.
   * Saqlashni bloklamaydi - faqat admin'ga ogohlantirish uchun. UZ matn bo'sh bo'lsa - null.
   */
  async templateFit(user: UserReq, dto: TemplateFitDto) {
    requireBranchAdmin(user);
    const current = (await this.settingsService.get()).contract;
    const texts = {
      warning: { ...current.warning, ...(dto.warning ?? {}) },
      terms: { ...current.terms, ...(dto.terms ?? {}) },
    };
    const l = await this.snapshotLogo();
    const logo = l ? Buffer.from(l.base64, 'base64') : null;
    const check = async (lang: ReceiptLang) => {
      if (!(texts.terms[lang]?.length ?? 0)) return null;
      return receiptFits(
        buildReceiptModel({ ...multiCitySample(), texts }, lang),
        { logo },
      );
    };
    return { ru: await check('ru'), uz: await check('uz') };
  }

  /** Keyingi Dogovor № (faqat ko'rsatish, band qilinmaydi) - «Yangi shartnoma» va Sozlamalar */
  async nextNumber(user: UserReq) {
    requireWriter(user);
    return peekContractNumber(this.dataSource.manager);
  }

  /**
   * Saqlamasdan tekshirish: forma holatini yuboradi, javobda ogohlantirishlar. Bazaga HECH NARSA yozilmaydi.
   * Hisob - xuddi shu yagona tekshiruv funksiyasi (checkContract).
   */
  async checkPreview(user: UserReq, dto: CheckPreviewDto) {
    requireWriter(user);
    const m = this.dataSource.manager;
    if (dto.contractId) {
      const b = await this.visibleBundle(m, user, {
        contractId: dto.contractId,
      });
      return {
        check: checkContract(applyDraft(toCheckInput(b), dto.contract)),
      };
    }
    if (!dto.tour) {
      throw new BadRequestException(
        'Shartnoma yoki tur ma‘lumoti (sanalar, turistlar soni) kerak',
      );
    }
    const base: CheckInput = {
      tour: {
        departureDate: dto.tour.departureDate ?? null,
        returnDate: dto.tour.returnDate ?? null,
        tourists: dto.tour.tourists,
        passengers: dto.tour.passengers,
      },
      flights: [],
      hotels: [],
      extras: [],
      insurance: 'not_included',
      visa: 'not_included',
    };
    return { check: checkContract(applyDraft(base, dto.contract)) };
  }

  /**
   * Mehmonxona nomi takliflari: filialdagi barcha shartnomalardan, shu shahar bo'yicha avval yozilgan nomlar
   * (10 tagacha, ko'p ishlatilganlari birinchi). Faqat o'qish. Xodim - faqat o'z kassalaridagi shartnomalardan
   * (kassa ko'rinish qoidasi bilan bir xil), admin - hammasidan.
   */
  async hotelNames(user: UserReq, q: HotelNamesQueryDto): Promise<string[]> {
    requireWriter(user);
    const qb = this.dataSource
      .createQueryBuilder()
      .select('MIN(TRIM(h.name))', 'name')
      .addSelect('COUNT(*)', 'n')
      .from('contract_hotels', 'h')
      .innerJoin('contracts', 'ct', 'ct.id = h.contract_id')
      .innerJoin('cash', 'c', 'c.id = ct.cash_id AND c.is_deleted = false')
      .where("h.name IS NOT NULL AND TRIM(h.name) <> ''");
    if (q.city) {
      qb.andWhere('LOWER(TRIM(h.city)) = LOWER(:city)', { city: q.city });
    }
    if (q.q) {
      qb.andWhere('h.name ILIKE :q', { q: `%${escapeLike(q.q)}%` });
    }
    if (!canViewAll(user.role)) {
      qb.andWhere('(c.user_id = :uid OR c.additional_user = :uid)', {
        uid: user.id,
      });
    }
    const rows = await qb
      .groupBy('LOWER(TRIM(h.name))')
      .orderBy('COUNT(*)', 'DESC')
      .addOrderBy('MIN(TRIM(h.name))', 'ASC')
      .limit(10)
      .getRawMany<{ name: string }>();
    return rows.map((r) => r.name);
  }

  /* ================================ yaratish ================================ */

  /**
   * «+ Yangi shartnoma» (dizayn 7): BITTA tranzaksiya - kassa (Qoralama, xizmatsiz) + shartnoma + to'lovlar.
   * Kassa va to'lov mavjud xizmatlar orqali (createCashInTx, addPaymentInTx) - «Tarix» avvalgidek.
   * Birortasi xato bo'lsa - hech narsa saqlanmaydi, raqam ham band bo'lmaydi.
   */
  async createWithCash(user: UserReq, dto: CreateContractWithCashDto) {
    requireWriter(user);
    // 8-qism: faqat 1-yo'lovchi (mijoz) majburiy - ism, familiya, telefon; qolganlari keyin kassada.
    // Turistlar soni alohida maydon va kiritilgan yo'lovchilardan kam bo'lmaydi.
    const client = dto.cash.passengers[0];
    if (
      !client?.firstName?.trim() ||
      !client.lastName?.trim() ||
      !client.phoneNumber?.trim()
    ) {
      throw new BadRequestException(
        'Mijozning (1-yo‘lovchi) ismi, familiyasi va telefoni majburiy',
      );
    }
    if (dto.cash.turist_count < dto.cash.passengers.length) {
      throw new BadRequestException(
        'Turistlar soni kiritilgan yo‘lovchilar sonidan kam bo‘lmasin',
      );
    }
    const cashBody: CreateCashDto = {
      ...dto.cash,
      comment: dto.cash.comment ?? '',
      status: CashStatus.DRAFT,
      services: [],
      moneys: [],
    };

    // Kassa Qoralama: to'lov qayta tekshiruvga qaytarmaydi, xabar yuborilmaydi
    const { cashId } = await this.dataSource.transaction(async (m) => {
      const number = await allocateContractNumber(m);
      await this.assertNumberFree(m, number);
      const cash = await this.cashService.createCashInTx(m, user, cashBody, {
        cashNumber: number,
        touristCount: dto.cash.turist_count,
      });
      const contract = await this.insertContract(
        m,
        user,
        cash.id,
        number,
        dto.contract,
      );
      await this.history(
        m,
        user,
        cash.id,
        'contract',
        `Shartnoma ${number} yaratildi`,
      );
      for (const p of dto.payments ?? []) {
        await this.cashService.addPaymentInTx(
          m,
          user,
          cash,
          p,
          'contract_create',
        );
      }
      return { cashId: cash.id, contractId: contract.id };
    });
    return this.getByCash(user, cashId);
  }

  /**
   * Shartnomasiz kassadan «Shartnoma tuzish». Raqam shartnomadan beriladi va kassaga ham yoziladi.
   * Kassada qo'lda yozilgan eski dogovor raqami bo'lsa - o'zgartirilmaydi (eski raqamlar o'zgarmaydi),
   * shuning uchun bunday kassada shartnoma hozircha tuzilmaydi (egasi bilan kelishiladi).
   */
  async createForCash(
    user: UserReq,
    cashId: number,
    dto: CreateContractForCashDto,
  ) {
    requireWriter(user);
    await this.dataSource.transaction(async (m) => {
      await m.query(`SELECT 1 FROM "cash" WHERE "id" = $1 FOR UPDATE`, [
        cashId,
      ]);
      const cash = await this.visibleCash(m, user, cashId);
      if (cash.status === 'cancelled') {
        throw new BadRequestException(
          'Bekor qilingan kassaga shartnoma tuzilmaydi',
        );
      }
      if (await m.getRepository(Contract).findOne({ where: { cashId } })) {
        throw new ConflictException('Bu kassada shartnoma allaqachon bor');
      }
      if (hasContractNumber(cash.cash_number)) {
        throw new ConflictException({
          code: 'CASH_HAS_NUMBER',
          message: `Kassada qo'lda yozilgan dogovor raqami bor (${cash.cash_number.trim()}) — eski raqam o'zgarmaydi, shartnoma tuzilmadi`,
        });
      }
      const number = await allocateContractNumber(m);
      await this.assertNumberFree(m, number);
      await m
        .getRepository(Cash)
        .update(
          { id: cashId },
          { cash_number: number, updated_at: new Date() },
        );
      await this.history(
        m,
        user,
        cashId,
        'cash_number',
        number,
        cash.cash_number,
      );
      await this.insertContract(m, user, cashId, number, dto.contract);
      await this.history(
        m,
        user,
        cashId,
        'contract',
        `Shartnoma ${number} yaratildi`,
      );
    });
    return this.getByCash(user, cashId);
  }

  /** Shartnoma raqami boshqa (qo'lda yozilgan) kassada band bo'lmasin */
  private async assertNumberFree(m: EntityManager, number: string) {
    const rows = await m.query<unknown[]>(
      `SELECT 1 FROM "cash" WHERE "is_deleted" = false AND LOWER(TRIM("cash_number")) = LOWER($1) LIMIT 1`,
      [number],
    );
    if (rows.length) {
      throw new ConflictException(
        `Dogovor raqami ${number} boshqa kassada band — administratorga murojaat qiling`,
      );
    }
  }

  /* ================================ tahrirlash ================================ */

  async update(user: UserReq, id: number, dto: ContractBodyDto) {
    requireWriter(user);
    const cashId = await this.dataSource.transaction(async (m) => {
      const b = await this.visibleBundle(m, user, { contractId: id }, true);
      this.assertEditable(b);
      const c = b.contract;
      const patch: Partial<Contract> = { updatedAt: new Date() };
      if (dto.lang) patch.lang = dto.lang;
      if (dto.insurance) patch.insurance = dto.insurance;
      if (dto.visa) patch.visa = dto.visa;
      await m.getRepository(Contract).update({ id }, patch);
      await this.writeRows(m, id, dto, c);
      await markChangedIfDiffers(m, Object.assign(c, patch), user.id);
      return c.cashId;
    });
    return this.getByCash(user, cashId);
  }

  private assertEditable(b: ContractBundle) {
    if (b.cash.status === 'cancelled' || b.contract.status === 'cancelled') {
      throw new BadRequestException(
        'Bekor qilingan shartnomani o‘zgartirib bo‘lmaydi',
      );
    }
  }

  /**
   * Kassa xizmati shartnomaning qaysi qatorlariga tegishli (xizmat oynasidagi tanlov).
   * Shu xizmatning eski bog'lanishlari to'liq almashtiriladi.
   */
  async setServiceLinks(
    user: UserReq,
    id: number,
    cashServiceId: number,
    dto: SetServiceLinksDto,
  ) {
    requireWriter(user);
    const cashId = await this.dataSource.transaction(async (m) => {
      const b = await this.visibleBundle(m, user, { contractId: id }, true);
      this.assertEditable(b);
      const cs = b.cash.cashServices.find((x) => x.id === cashServiceId);
      if (!cs) throw new NotFoundException('Kassa xizmati topilmadi');
      const c = b.contract;
      const rows = dto.items.map((it) => {
        const base = {
          cashServiceId,
          contractId: c.id,
          itemType: it.type,
          flightId: null as number | null,
          hotelId: null as number | null,
          extraId: null as number | null,
        };
        const need = (list: { id: number }[], what: string) => {
          if (!it.id || !list.some((x) => x.id === it.id)) {
            throw new BadRequestException(
              `${what} #${it.id ?? '?'} bu shartnomada yo'q`,
            );
          }
          return it.id;
        };
        if (it.type === 'flight') base.flightId = need(c.flights, 'Parvoz');
        else if (it.type === 'hotel')
          base.hotelId = need(c.hotels, 'Mehmonxona');
        else if (it.type === 'extra')
          base.extraId = need(c.extras, "Qo'shimcha xizmat");
        return base;
      });
      const key = (r: (typeof rows)[number]) =>
        `${r.itemType}:${r.flightId ?? r.hotelId ?? r.extraId ?? 0}`;
      const unique = [...new Map(rows.map((r) => [key(r), r])).values()];

      const repo = m.getRepository(CashServiceContractLink);
      await repo.delete({ cashServiceId });
      if (unique.length) await repo.insert(unique);

      const label = (r: (typeof rows)[number]) => {
        if (r.flightId) {
          const i = c.flights.findIndex((x) => x.id === r.flightId);
          return `parvoz ${i + 1}`;
        }
        if (r.hotelId) {
          const i = c.hotels.findIndex((x) => x.id === r.hotelId);
          return `mehmonxona ${i + 1} (${c.hotels[i].city})`;
        }
        if (r.extraId) {
          const i = c.extras.findIndex((x) => x.id === r.extraId);
          return `qo'shimcha ${i + 1}`;
        }
        return r.itemType;
      };
      await this.history(
        m,
        user,
        c.cashId,
        'contract_link',
        `${cashServiceLabel(cs)} → ${unique.map(label).join(', ') || "bog'lanmagan"}`,
      );
      return c.cashId;
    });
    return this.getByCash(user, cashId);
  }

  /** «Ha, har nomer alohida» / «Yo'q, bitta umumiy» - tanlov saqlanadi va tarixga yoziladi */
  async setRoomsSeparate(
    user: UserReq,
    id: number,
    hotelId: number,
    dto: RoomsSeparateDto,
  ) {
    requireWriter(user);
    const cashId = await this.dataSource.transaction(async (m) => {
      const b = await this.visibleBundle(m, user, { contractId: id }, true);
      this.assertEditable(b);
      const i = b.contract.hotels.findIndex((h) => h.id === hotelId);
      if (i < 0) throw new NotFoundException('Mehmonxona topilmadi');
      const h = b.contract.hotels[i];
      await m
        .getRepository(ContractHotel)
        .update({ id: hotelId }, { roomsSeparateConfirmed: dto.confirmed });
      await this.history(
        m,
        user,
        b.contract.cashId,
        'contract_rooms',
        `Mehmonxona ${i + 1} (${h.city}): ${dto.confirmed ? 'har nomer alohida xizmat' : 'bitta umumiy xizmat'}`,
        h.roomsSeparateConfirmed ? 'har nomer alohida xizmat' : '',
      );
      return b.contract.cashId;
    });
    return this.getByCash(user, cashId);
  }

  /* ================================ berish (versiyalar) ================================ */

  /**
   * Chop etish / PDF / Telegram. Mazmun oxirgi versiyadan farq qilsa (yoki hali berilmagan bo'lsa) -
   * yangi versiya (v1, v2 ...), holat «Berilgan». Farq qilmasa - versiya yangilanmaydi, faqat tarixga
   * «qayta chop etildi» yoziladi. Versiyalar o'zgarmaydi va o'chmaydi (bazada trigger).
   */
  async issue(
    user: UserReq,
    id: number,
    dto: IssueContractDto,
    /** Telegram: yuborish shu yerda - yuborilmasa tranzaksiya bekor, versiya yozilmaydi */
    afterVersion?: (info: {
      version: number;
      token: string;
      snapshot: ContractSnapshot;
      b: ContractBundle;
      m: EntityManager;
    }) => Promise<void>,
  ) {
    requireWriter(user);
    const settings = await this.settingsService.get();
    const logo = await this.snapshotLogo();
    return this.dataSource.transaction(async (m) => {
      const b = await this.visibleBundle(m, user, { contractId: id }, true);
      this.assertEditable(b);
      const c = b.contract;
      const last = await latestVersion(m, c.id);
      const hashNow = contentHash(buildContent(b));
      const lastHash = (last?.snapshot as { contentHash?: string } | undefined)
        ?.contentHash;

      // Oxirgi versiya so'ralgan tilda shartlarsiz berilgan bo'lsa (UZ matn keyin kiritilgan) - shu tilda
      // chiqarib bo'lmaydi: yangi versiya yoziladi (u hozirgi matnlarni saqlaydi)
      const lang = (dto.lang ?? c.lang) as ReceiptLang;
      const lastTerms = (
        last?.snapshot as { texts?: { terms?: Record<string, string[]> } }
      )?.texts?.terms?.[lang];
      const langTextsMissing =
        !!last &&
        !(lastTerms?.length ?? 0) &&
        (settings.contract.terms[lang]?.length ?? 0) > 0;

      if (last && lastHash === hashNow && !langTextsMissing) {
        if (c.status === 'changed') {
          await setContractStatus(m, c, 'issued', user.id, `v${last.version}`);
        }
        await afterVersion?.({
          version: last.version,
          token: last.publicToken,
          snapshot: last.snapshot as ContractSnapshot,
          b,
          m,
        });
        await this.history(
          m,
          user,
          c.cashId,
          'contract_version',
          `v${last.version} qayta berildi (${dto.channel})`,
        );
        return {
          created: false,
          version: last.version,
          snapshot: last.snapshot,
        };
      }

      const version = (last?.version ?? 0) + 1;
      const snapshot = buildSnapshot(
        b,
        settings,
        {
          version,
          issuedAt: new Date().toISOString(),
          channel: dto.channel,
          lang: dto.lang ?? c.lang,
        },
        logo,
      );
      // Kvitansiya doim bitta sahifa: sig'masa versiya yozilmaydi (PDF ham yaratilmaydi)
      const fits = await receiptFits(
        buildReceiptModel(snapshotToReceiptInput(snapshot), lang),
        {
          logo: logo ? Buffer.from(logo.base64, 'base64') : null,
          issuedAt: snapshot.issuedAt,
        },
      );
      if (!fits) throw new BadRequestException(TOO_LONG_MESSAGE);
      const versions = m.getRepository(ContractVersion);
      const publicToken = randomBytes(32).toString('base64url');
      await versions.save(
        versions.create({
          contractId: c.id,
          version,
          snapshot,
          channel: dto.channel,
          issuedBy: { id: user.id },
          // QR ochiq sahifa tokeni: 32 bayt tasodifiy, versiya bilan o'zgarmaydi
          publicToken,
        }),
      );
      await m
        .getRepository(Contract)
        .update(
          { id: c.id },
          { currentVersion: version, updatedAt: new Date() },
        );
      await setContractStatus(m, c, 'issued', user.id, `v${version}`);
      await afterVersion?.({ version, token: publicToken, snapshot, b, m });
      await this.history(
        m,
        user,
        c.cashId,
        'contract_version',
        `v${version} berildi (${dto.channel})`,
      );
      return { created: true, version, snapshot };
    });
  }

  /** Mijoz imzoladi: «Berilgan» -> «Imzolangan» */
  async sign(user: UserReq, id: number) {
    requireWriter(user);
    const cashId = await this.dataSource.transaction(async (m) => {
      const b = await this.visibleBundle(m, user, { contractId: id }, true);
      this.assertEditable(b);
      if (b.contract.status !== 'issued') {
        throw new BadRequestException(
          'Faqat berilgan (chop etilgan) shartnoma imzolanadi',
        );
      }
      await setContractStatus(
        m,
        b.contract,
        'signed',
        user.id,
        `v${b.contract.currentVersion}`,
      );
      return b.contract.cashId;
    });
    return this.getByCash(user, cashId);
  }

  /** Berilgan versiya (snapshot). 'latest' - oxirgisi (buxgalter PDF'ni shundan yuklaydi) */
  async version(user: UserReq, id: number, v: string) {
    requireReader(user);
    const m = this.dataSource.manager;
    const b = await this.visibleBundle(m, user, { contractId: id });
    const row =
      v === 'latest'
        ? await latestVersion(m, b.contract.id)
        : await m.getRepository(ContractVersion).findOne({
            where: { contractId: b.contract.id, version: Number(v) || -1 },
          });
    if (!row) throw new NotFoundException('Versiya topilmadi');
    return {
      version: row.version,
      issuedAt: row.issuedAt,
      channel: row.channel,
      snapshot: row.snapshot,
    };
  }

  /** Logotip rasmi snapshot uchun: faqat PNG/JPEG (pdfkit SVG'ni chizmaydi) */
  private async snapshotLogo() {
    const l = await this.settingsService.getLogo();
    // buzuq rasm snapshot'ga kirmaydi (PDF yasashda server yiqilishi mumkin) - faqat firma nomi chiqadi
    if (!l || !isDrawableLogo(l.logo, l.mime)) return null;
    return { mime: l.mime, base64: l.logo.toString('base64') };
  }

  /* ================================ kvitansiya: jonli ko'rinish, PDF, Telegram ================================ */

  /**
   * Jonli ko'rinish: saqlanmagan forma holatidan kvitansiya modeli (PDF bilan bir xil matn funksiyasi).
   * Bazaga yozilmaydi va o'qilmaydi; firma ma'lumoti va shartlar - joriy Sozlamalardan.
   */
  async receiptPreview(user: UserReq, dto: ReceiptPreviewDto) {
    requireReader(user);
    const settings = await this.settingsService.get();
    const lang = dto.lang as ReceiptLang;
    const input: ReceiptInput = {
      ...(dto.content as ReceiptInput),
      firm: {
        name: settings.brand.name,
        address: settings.brand.address,
        phone: settings.brand.phone,
        telegram: settings.brand.telegram,
        logoUrl: settings.brand.logoUrl,
      },
      texts: {
        warning: settings.contract.warning,
        terms: settings.contract.terms,
      },
    };
    const model = buildReceiptModel(input, lang);
    // bitta sahifaga sig'adimi (joriy logotip bilan - PDF'dagidek)
    const l = await this.snapshotLogo();
    const fits = await receiptFits(model, {
      logo: l ? Buffer.from(l.base64, 'base64') : null,
    });
    return { model, fits };
  }

  /** Versiya snapshot'i -> PDF (versiya o'zgarmaydi; eski versiya aynan o'sha paytdagidek chiqadi) */
  async versionPdf(
    user: UserReq,
    id: number,
    v: string,
    langParam?: string,
  ): Promise<{ pdf: Buffer; filename: string }> {
    requireReader(user);
    const m = this.dataSource.manager;
    const b = await this.visibleBundle(m, user, { contractId: id });
    const last = await latestVersion(m, b.contract.id);
    const row =
      v === 'latest'
        ? last
        : await m.getRepository(ContractVersion).findOne({
            where: { contractId: b.contract.id, version: Number(v) || -1 },
          });
    if (!row) throw new NotFoundException('Versiya topilmadi');
    // Buxgalter faqat oxirgi berilgan versiyani ko'radi
    if (user.role === 'ACCOUNTANT' && row.version !== last?.version) {
      throw new ForbiddenException('Faqat oxirgi berilgan versiya ko‘rinadi');
    }
    const snapshot = row.snapshot as ContractSnapshot;
    const lang = (
      langParam === 'ru' || langParam === 'uz' ? langParam : snapshot.lang
    ) as ReceiptLang;
    return this.renderSnapshotPdf(
      snapshot,
      lang === 'uz' ? 'uz' : 'ru',
      b.contract.number,
      row.publicToken,
    );
  }

  private async renderSnapshotPdf(
    snapshot: ContractSnapshot,
    lang: ReceiptLang,
    number: string,
    /** versiya tokeni - kvitansiyadagi QR shu versiyaning ochiq sahifasiga olib boradi */
    token: string | null,
  ) {
    if (lang === 'uz' && !(snapshot.texts?.terms?.uz?.length ?? 0)) {
      throw new BadRequestException(
        "O'zbekcha shartlar Sozlamalarda kiritilmagan",
      );
    }
    const model = buildReceiptModel(snapshotToReceiptInput(snapshot), lang);
    const logoBuf = snapshot.firm?.logo
      ? Buffer.from(snapshot.firm.logo.base64, 'base64')
      : null;
    // eski/buzuq snapshot logotipi ham tekshiriladi: xavfli bo'lsa PDF logotipsiz chiqadi
    const logo = isDrawableLogo(logoBuf, snapshot.firm?.logo?.mime)
      ? logoBuf
      : null;
    let pdf: Buffer;
    try {
      pdf = await renderReceiptPdf(model, {
        logo,
        issuedAt: snapshot.issuedAt,
        qr: token ? await receiptQrPng(token) : null,
      });
    } catch (e) {
      if (e instanceof ReceiptTooLongError) {
        throw new BadRequestException(TOO_LONG_MESSAGE);
      }
      throw e;
    }
    return { pdf, filename: `Dogovor-${number}-v${snapshot.version}.pdf` };
  }

  /**
   * Telegram: mijozga yuboriladi (kassadagi mijozning ulangan Telegram'i). Versiya yozilishi va yuborish bitta
   * tranzaksiyada: yuborib bo'lmasa - versiya ham yozilmaydi.
   */
  async sendTelegram(user: UserReq, id: number, dto: SendContractTelegramDto) {
    requireWriter(user);
    const lang = dto.lang === 'uz' ? 'uz' : 'ru';
    const result = await this.issue(
      user,
      id,
      { channel: 'telegram', lang },
      async ({ snapshot, token, b, m }) => {
        const passengers = await m.getRepository(Passenger).find({
          where: { cash: { id: b.contract.cashId } },
          relations: { client: true },
          order: { id: 'ASC' },
        });
        const chatId = passengers.find((p) => p.client?.telegramChatId)?.client
          ?.telegramChatId;
        if (!chatId) {
          throw new BadRequestException(
            "Mijozning Telegram'i ulanmagan: mijoz kartasida Telegram username bo'lishi va mijoz botga /start bosgan bo'lishi kerak",
          );
        }
        const { pdf, filename } = await this.renderSnapshotPdf(
          snapshot,
          lang,
          b.contract.number,
          token,
        );
        try {
          await this.botService.sendDocument(
            chatId,
            pdf,
            filename,
            `${lang === 'uz' ? 'Dogovor' : 'Договор'} №${b.contract.number}`,
          );
        } catch {
          throw new BadRequestException(
            "Telegram orqali yuborib bo'lmadi: mijoz botni bloklagan bo'lishi mumkin",
          );
        }
      },
    );
    return { sent: true, version: result.version, created: result.created };
  }

  /* ================================ QR ochiq sahifa (8-bosqich) ================================ */

  /**
   * LOGINSIZ ko'rinish: faqat shu maydonlar (ichki ID, kassa ID, xodim, netto, xizmatlar, hamkorlar - YO'Q).
   * Token formati noto'g'ri bo'lsa ham, topilmasa ham - bir xil 404.
   * Tur ma'lumoti - versiyadan (qog'ozdagidek); narx, to'langan, qoldiq - hozirgi holat (kassadan).
   */
  async publicView(token: string) {
    const notFound = () => new NotFoundException('Topilmadi');
    if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) {
      throw notFound();
    }
    const m = this.dataSource.manager;
    const row = await m
      .getRepository(ContractVersion)
      .findOne({ where: { publicToken: token } });
    if (!row) throw notFound();
    const contract = await m
      .getRepository(Contract)
      .findOne({ where: { id: row.contractId } });
    if (!contract) throw notFound();
    const cash = await m.getRepository(Cash).findOne({
      where: { id: contract.cashId },
      relations: { brutto: true, moneys: true },
    });
    const last = await latestVersion(m, row.contractId);
    const snap = row.snapshot as ContractSnapshot;
    const content = (snap.content ?? {}) as Partial<ContractContent>;
    const cancelled =
      !cash ||
      cash.isDeleted ||
      cash.status === 'cancelled' ||
      contract.status === 'cancelled';
    const status = cancelled
      ? 'cancelled'
      : last && last.version !== row.version
        ? 'outdated'
        : 'valid';
    const pay = cash ? buildPayments(cash) : null;
    const settings = await this.settingsService.get();
    return {
      status,
      firm: {
        name: snap.firm?.name ?? settings.brand.name,
        logoUrl: settings.brand.logoUrl ?? null,
      },
      number: contract.number,
      version: row.version,
      issuedAt: row.issuedAt,
      lang: snap.lang === 'uz' ? 'uz' : 'ru',
      current:
        status === 'outdated' && last
          ? { version: last.version, issuedAt: last.issuedAt }
          : null,
      tour: {
        destination: content.tour?.destination ?? null,
        departureDate: content.tour?.departureDate ?? null,
        returnDate: content.tour?.returnDate ?? null,
        tourists: content.tour?.tourists ?? null,
      },
      money: pay
        ? {
            currency: cash?.brutto?.currency ?? 'UZS',
            price: Number(cash?.brutto?.amount ?? 0),
            paid: pay.paidInCurrency,
            paidUzs: pay.paidUzs,
            debt: Math.max(pay.debtInCurrency, 0),
            debtUzs: Math.max(pay.debtUzs, 0),
          }
        : null,
      asOf: new Date().toISOString(),
      client: {
        name: maskClientName(content.client?.name ?? null),
        phone: maskPhone(content.client?.phone ?? null),
      },
    };
  }

  /* ================================ bo'lib to'lash provayderlari ================================ */

  async listProviders(user: UserReq) {
    requireReader(user);
    return this.providerRepo.find({ order: { isActive: 'DESC', name: 'ASC' } });
  }

  async createProvider(user: UserReq, dto: CreateProviderDto) {
    requireBranchAdmin(user);
    await this.assertProviderNameFree(dto.name);
    return this.providerRepo.save({ name: dto.name, isActive: true });
  }

  async updateProvider(user: UserReq, id: number, dto: UpdateProviderDto) {
    requireBranchAdmin(user);
    const p = await this.providerRepo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Topilmadi');
    if (dto.name && dto.name !== p.name) {
      await this.assertProviderNameFree(dto.name, id);
    }
    await this.providerRepo.update(
      { id },
      {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
      },
    );
    return this.providerRepo.findOne({ where: { id } });
  }

  private async assertProviderNameFree(name: string, excludeId?: number) {
    const found = await this.providerRepo
      .createQueryBuilder('p')
      .where('LOWER(p.name) = LOWER(:name)', { name })
      .getOne();
    if (found && found.id !== excludeId) {
      throw new ConflictException('Bunday nom allaqachon bor');
    }
  }
}
