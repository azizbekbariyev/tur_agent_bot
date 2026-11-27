import { Check, Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * Dogovor raqami hisoblagichi - bitta qator (id = 1), migratsiyada yaratiladi.
 * Yangi raqam: UPDATE ... SET last_value = last_value + 1 WHERE id = 1 RETURNING last_value
 * shartnoma yaratish tranzaksiyasi ICHIDA - qator tranzaksiya oxirigacha qulflanadi, ikki xodim bir xil
 * raqam ola olmaydi; tranzaksiya bekor bo'lsa raqam ham qaytadi (oraliq bo'shliq qolmaydi).
 * Harf (A/B) bu yerda emas - server sozlamasi CONTRACT_PREFIX; harf o'zgarsa ham hisoblagich davom etadi.
 */
@Entity('contract_counter')
@Check('CHK_contract_counter_single_row', '"id" = 1')
@Check('CHK_contract_counter_last_value', '"last_value" >= 0')
export class ContractCounter {
  @PrimaryColumn({
    type: 'smallint',
    primaryKeyConstraintName: 'PK_contract_counter',
  })
  id!: number;

  @Column({ name: 'last_value', type: 'integer', default: 0 })
  lastValue!: number;
}
