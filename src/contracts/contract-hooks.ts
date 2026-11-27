/**
 * Kassa o'zgarganda shartnomaga ta'siri (CashService shu funksiyalarni o'z tranzaksiyasi ichida chaqiradi).
 * DI'siz oddiy funksiyalar - CashService va ContractsService o'rtasida aylana bog'liqlik bo'lmasin.
 * Shartnomasi YO'Q kassada hech narsa qilmaydi - eski kassalar avvalgidek ishlaydi.
 */
import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Contract } from '../bot/models/contract';
import { History } from '../bot/models/history';
import { checkContract, CheckIssue } from './contract-check';
import {
  buildContent,
  contentHash,
  latestVersion,
  loadContractBundle,
  toCheckInput,
} from './contract-data';

/** Shartnomasi bor kassa raqami qo'lda o'zgartirilmaydi */
export async function contractOfCash(manager: EntityManager, cashId: number) {
  return manager.getRepository(Contract).findOne({ where: { cashId } });
}

/**
 * Kassa saqlangandan keyin (o'sha tranzaksiyada):
 * - kassa bekor qilingan bo'lsa - shartnoma ham «Bekor qilingan»;
 * - shartnoma berilgan/imzolangan bo'lsa va kvitansiya mazmuni oxirgi versiyadan farq qilsa - «O'zgargan».
 */
export async function syncContractAfterCashChange(
  manager: EntityManager,
  cashId: number,
  userId: number,
) {
  const contract = await contractOfCash(manager, cashId);
  if (!contract || contract.status === 'cancelled') return;

  const cashRow = await manager.query<{ status: string }[]>(
    `SELECT "status" FROM "cash" WHERE "id" = $1`,
    [cashId],
  );
  if (cashRow[0]?.status === 'cancelled') {
    await setContractStatus(manager, contract, 'cancelled', userId);
    return;
  }
  if (contract.status !== 'issued' && contract.status !== 'signed') return;
  await markChangedIfDiffers(manager, contract, userId);
}

/** Berilgan/imzolangan shartnoma mazmuni oxirgi versiyadan farq qilsa - «O'zgargan — qayta imzo» */
export async function markChangedIfDiffers(
  manager: EntityManager,
  contract: Contract,
  userId: number,
) {
  if (contract.status !== 'issued' && contract.status !== 'signed') return;
  const last = await latestVersion(manager, contract.id);
  if (!last) return;
  const bundle = await loadContractBundle(manager, { contractId: contract.id });
  if (!bundle) return;
  const now = contentHash(buildContent(bundle));
  if (now !== (last.snapshot as { contentHash?: string }).contentHash) {
    await setContractStatus(manager, contract, 'changed', userId);
  }
}

export async function setContractStatus(
  manager: EntityManager,
  contract: Contract,
  status: string,
  userId: number,
  comment?: string,
) {
  if (contract.status === status) return;
  await manager
    .getRepository(Contract)
    .update({ id: contract.id }, { status, updatedAt: new Date() });
  await manager.getRepository(History).save({
    name: 'contract_status',
    old_column: contract.status,
    new_column: comment ? `${status} — ${comment}` : status,
    user: { id: userId },
    cash: { id: contract.cashId },
  });
  contract.status = status;
}

/** Kassa «Tasdiqlashga yuborish» / «Tasdiqlash» holatiga o'tganda so'raladigan ogohlantirishlar */
const CONFIRM_STATUSES = ['pending_approval', 'approved'];

/**
 * Shartnoma bilan solishtirishda ogohlantirish bo'lsa, holat o'zgarishi foydalanuvchi ko'rib
 * «davom etish»ni tanlagandagina o'tadi (acknowledge = true). Tanlov kassa tarixiga yoziladi.
 * Aks holda 409 - frontend ro'yxatni ko'rsatib, tasdiqlash oynasini ochadi.
 */
export async function assertContractWarningsAcknowledged(
  manager: EntityManager,
  opts: {
    cashId: number;
    nextStatus: string;
    acknowledged?: boolean;
    userId: number;
    role: string;
  },
) {
  if (!CONFIRM_STATUSES.includes(opts.nextStatus)) return;
  // Superadmin filial saytida shartnoma bo'limini ko'rmaydi (4-qism) - unga so'ralmaydi
  if (opts.role === 'SUPERADMIN') return;
  const bundle = await loadContractBundle(manager, { cashId: opts.cashId });
  if (!bundle || bundle.contract.status === 'cancelled') return;

  const result = checkContract(toCheckInput(bundle));
  const warnings: CheckIssue[] = [
    ...result.internal,
    ...(result.compare ?? []),
  ].filter(
    (x) =>
      x.level === 'warn' ||
      x.level === 'ask' ||
      // Yo'lovchilar to'liq emas: sahifada kulrang izoh, lekin «Tasdiqlash»da so'raladi (8-qism)
      x.code === 'passengers_incomplete',
  );
  if (!warnings.length) return;

  if (!opts.acknowledged) {
    throw new ConflictException({
      code: 'CONTRACT_WARNINGS',
      message: `Shartnoma bilan solishtirishda ${warnings.length} ta ogohlantirish bor`,
      warnings,
    });
  }
  await manager.getRepository(History).save({
    name: 'contract_warnings',
    old_column: '',
    new_column:
      `${opts.nextStatus}: ${warnings.length} ta ogohlantirish bilan davom etildi — ${warnings
        .map((w) => w.uz)
        .join('; ')}`.slice(0, 4000),
    user: { id: opts.userId },
    cash: { id: opts.cashId },
  });
}
