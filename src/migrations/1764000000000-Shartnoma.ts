import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Shartnoma bo'limi (1-bosqich): jadvallar, raqam hisoblagichi, to'lov turlari kengaytmasi.
 *
 * 1) money.type: CASH / CARD / TRANSFER -> CASH / CARD_TRANSFER / INSTALLMENT / BANK_ACCOUNT / TERMINAL.
 *    Eski yozuvlar (egasining qarori, 2026-11-24): CASH -> CASH, CARD -> CARD_TRANSFER, TRANSFER -> CARD_TRANSFER.
 *    "ALTER TYPE ... ADD VALUE" ISHLATILMAYDI (PG 12+ da ham yangi qiymatni o'sha tranzaksiyada ishlatib
 *    bo'lmaydi): enum turi almashtiriladi (eskisi nomi o'zgartiriladi -> yangisi yaratiladi -> ustun CASE bilan
 *    o'tkaziladi -> eskisi o'chiriladi). Hammasi bitta tranzaksiyada, PostgreSQL 9.x+ da ishlaydi.
 *    Bu migratsiyasiz synchronize o'zi "type::text::money_type_enum" qiladi va eski 'CARD' yozuvlarida
 *    xato bilan to'xtaydi (backend ishga tushmaydi) - shuning uchun migratsiya synchronize'dan OLDIN.
 * 2) money.source (manual / contract_create; eski yozuvlar - manual), money.provider_id (bo'lib to'lash).
 * 3) Shartnoma jadvallari. SQL TypeORM'ning o'zi yaratadigan SQL bilan aynan bir xil (nomlar, turlar,
 *    cheklovlar) - synchronize keyin hech narsa o'zgartirmaydi (sxema farqi 0, nusxa bazada tekshirilgan).
 * 4) TypeORM bilmaydigan qismlar (synchronize ularga tegmaydi):
 *    - contract_versions: UPDATE/DELETE/TRUNCATE trigger bilan taqiqlangan;
 *    - UQ_cscl_item: bir xil bog'lanish ikki marta yozilmaydi (ifodali unique indeks);
 *    - contract_counter: yagona qator (id = 1, last_value = 0).
 *
 * Idempotent: qayta ishga tushsa, bor narsani qayta yaratmaydi. Yangi (bo'sh) baza: cash jadvali yo'q -
 * hech narsa qilmaydi, synchronize jadvallarni o'zi yaratadi (trigger va ifodali indeksiz - CashSeqNo kabi
 * cheklov; hozircha faqat mavjud 2 filial bazasi bor).
 */
export class Shartnoma1764000000000 implements MigrationInterface {
  name = 'Shartnoma1764000000000';

  private async exists(q: QueryRunner, sql: string, params: unknown[] = []) {
    const rows = (await q.query(sql, params)) as unknown[];
    return rows.length > 0;
  }

  async up(q: QueryRunner): Promise<void> {
    const cash = (await q.query(
      `SELECT to_regclass(current_schema() || '.cash') AS t`,
    )) as { t: string | null }[];
    if (!cash[0]?.t) return; // yangi baza: synchronize o'zi yaratadi

    // ---------------- 1. Bo'lib to'lash provayderlari ----------------
    if (
      !(await this.exists(
        q,
        `SELECT 1 FROM pg_class WHERE relname = 'installment_providers' AND relkind = 'r'`,
      ))
    ) {
      await q.query(
        `CREATE TABLE "installment_providers" ("id" SERIAL NOT NULL, "name" character varying(100) NOT NULL, "is_active" boolean NOT NULL DEFAULT true, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_installment_providers" PRIMARY KEY ("id"))`,
      );
      await q.query(
        `CREATE UNIQUE INDEX "UQ_installment_providers_name" ON "installment_providers" ("name")`,
      );
    }

    // ---------------- 2. To'lovlar (money) ----------------
    const newEnum = await this.exists(
      q,
      `SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'money_type_enum' AND e.enumlabel = 'CARD_TRANSFER'`,
    );
    if (!newEnum) {
      await q.query(
        `ALTER TYPE "public"."money_type_enum" RENAME TO "money_type_enum_old"`,
      );
      await q.query(
        `CREATE TYPE "public"."money_type_enum" AS ENUM('CASH', 'CARD_TRANSFER', 'INSTALLMENT', 'BANK_ACCOUNT', 'TERMINAL')`,
      );
      await q.query(
        `ALTER TABLE "money" ALTER COLUMN "type" TYPE "public"."money_type_enum" USING (
           CASE "type"::text
             WHEN 'CARD' THEN 'CARD_TRANSFER'
             WHEN 'TRANSFER' THEN 'CARD_TRANSFER'
             ELSE "type"::text
           END
         )::"public"."money_type_enum"`,
      );
      await q.query(`DROP TYPE "public"."money_type_enum_old"`);
    }

    if (
      !(await this.exists(
        q,
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'money' AND column_name = 'source'`,
      ))
    ) {
      await q.query(
        `CREATE TYPE "public"."money_source_enum" AS ENUM('manual', 'contract_create')`,
      );
      await q.query(
        `ALTER TABLE "money" ADD "source" "public"."money_source_enum" NOT NULL DEFAULT 'manual'`,
      );
    }
    if (
      !(await this.exists(
        q,
        `SELECT 1 FROM information_schema.columns WHERE table_name = 'money' AND column_name = 'provider_id'`,
      ))
    ) {
      await q.query(`ALTER TABLE "money" ADD "provider_id" integer`);
      await q.query(
        `ALTER TABLE "money" ADD CONSTRAINT "CHK_money_installment_provider" CHECK (("type" = 'INSTALLMENT') = ("provider_id" IS NOT NULL))`,
      );
      await q.query(
        `ALTER TABLE "money" ADD CONSTRAINT "FK_money_provider" FOREIGN KEY ("provider_id") REFERENCES "installment_providers"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
      );
    }

    // ---------------- 3. Shartnoma jadvallari ----------------
    if (
      await this.exists(
        q,
        `SELECT 1 FROM pg_class WHERE relname = 'contracts' AND relkind = 'r'`,
      )
    ) {
      return; // avval bajarilgan
    }

    await q.query(
      `CREATE TYPE "public"."contracts_status_enum" AS ENUM('draft', 'issued', 'signed', 'changed', 'cancelled')`,
    );
    await q.query(
      `CREATE TYPE "public"."contracts_lang_enum" AS ENUM('ru', 'uz')`,
    );
    await q.query(
      `CREATE TYPE "public"."contracts_insurance_enum" AS ENUM('included', 'not_included')`,
    );
    await q.query(
      `CREATE TYPE "public"."contracts_visa_enum" AS ENUM('included', 'not_included', 'not_required')`,
    );
    await q.query(
      `CREATE TABLE "contracts" ("id" SERIAL NOT NULL, "cash_id" integer NOT NULL, "number" character varying(16) NOT NULL, "status" "public"."contracts_status_enum" NOT NULL DEFAULT 'draft', "current_version" integer NOT NULL DEFAULT '0', "lang" "public"."contracts_lang_enum" NOT NULL DEFAULT 'ru', "insurance" "public"."contracts_insurance_enum" NOT NULL DEFAULT 'not_included', "visa" "public"."contracts_visa_enum" NOT NULL DEFAULT 'not_included', "public_token" character varying(64) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "created_by" integer NOT NULL, CONSTRAINT "PK_contracts" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_contracts_public_token" ON "contracts" ("public_token")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_contracts_number" ON "contracts" ("number")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_contracts_cash_id" ON "contracts" ("cash_id")`,
    );
    await q.query(
      `ALTER TABLE "contracts" ADD CONSTRAINT "FK_contracts_cash" FOREIGN KEY ("cash_id") REFERENCES "cash"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "contracts" ADD CONSTRAINT "FK_contracts_created_by" FOREIGN KEY ("created_by") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );

    await q.query(
      `CREATE TABLE "contract_flights" ("id" SERIAL NOT NULL, "contract_id" integer NOT NULL, "position" smallint NOT NULL, "from_city" character varying(100) NOT NULL, "to_city" character varying(100) NOT NULL, "transit_city" character varying(100), "date" date, "airline" character varying(100), "baggage_type" character varying(50), "baggage_pax_count" smallint NOT NULL DEFAULT '0', CONSTRAINT "CHK_contract_flights_baggage_pax" CHECK ("baggage_pax_count" >= 0), CONSTRAINT "PK_contract_flights" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE INDEX "IDX_contract_flights_contract_id" ON "contract_flights" ("contract_id")`,
    );
    await q.query(
      `ALTER TABLE "contract_flights" ADD CONSTRAINT "FK_contract_flights_contract" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await q.query(
      `CREATE TYPE "public"."contract_hotels_placement_enum" AS ENUM('SGL', 'DBL', 'TWN', 'TRPL')`,
    );
    await q.query(
      `CREATE TYPE "public"."contract_hotels_meal_enum" AS ENUM('RO', 'BB', 'HB', 'FB', 'AI', 'UAI')`,
    );
    await q.query(
      `CREATE TYPE "public"."contract_hotels_transfer_type_enum" AS ENUM('group', 'individual', 'none')`,
    );
    await q.query(
      `CREATE TYPE "public"."contract_hotels_transfer_route_enum" AS ENUM('full', 'arrival', 'departure')`,
    );
    await q.query(
      `CREATE TABLE "contract_hotels" ("id" SERIAL NOT NULL, "contract_id" integer NOT NULL, "position" smallint NOT NULL, "city" character varying(100) NOT NULL, "name" character varying(200), "stars" smallint, "room_type" character varying(100), "placement" "public"."contract_hotels_placement_enum", "rooms_count" smallint NOT NULL DEFAULT '1', "meal" "public"."contract_hotels_meal_enum", "check_in" date, "check_out" date, "transfer_type" "public"."contract_hotels_transfer_type_enum" NOT NULL DEFAULT 'none', "transfer_route" "public"."contract_hotels_transfer_route_enum", "rooms_separate_confirmed" boolean NOT NULL DEFAULT false, CONSTRAINT "CHK_contract_hotels_dates" CHECK ("check_in" IS NULL OR "check_out" IS NULL OR "check_out" > "check_in"), CONSTRAINT "CHK_contract_hotels_stars" CHECK ("stars" IS NULL OR "stars" BETWEEN 1 AND 5), CONSTRAINT "CHK_contract_hotels_rooms_count" CHECK ("rooms_count" >= 1), CONSTRAINT "PK_contract_hotels" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE INDEX "IDX_contract_hotels_contract_id" ON "contract_hotels" ("contract_id")`,
    );
    await q.query(
      `ALTER TABLE "contract_hotels" ADD CONSTRAINT "FK_contract_hotels_contract" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await q.query(
      `CREATE TYPE "public"."contract_extras_payment_mode_enum" AS ENUM('included', 'separate')`,
    );
    await q.query(
      `CREATE TABLE "contract_extras" ("id" SERIAL NOT NULL, "contract_id" integer NOT NULL, "position" smallint NOT NULL, "name" character varying(200) NOT NULL, "city" character varying(100), "date" date, "pax" smallint, "payment_mode" "public"."contract_extras_payment_mode_enum" NOT NULL DEFAULT 'included', "price_usd" numeric(15,2), CONSTRAINT "CHK_contract_extras_price" CHECK (("payment_mode" = 'separate' OR "price_usd" IS NULL) AND ("price_usd" IS NULL OR "price_usd" >= 0)), CONSTRAINT "CHK_contract_extras_pax" CHECK ("pax" IS NULL OR "pax" >= 1), CONSTRAINT "PK_contract_extras" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE INDEX "IDX_contract_extras_contract_id" ON "contract_extras" ("contract_id")`,
    );
    await q.query(
      `ALTER TABLE "contract_extras" ADD CONSTRAINT "FK_contract_extras_contract" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await q.query(
      `CREATE TYPE "public"."contract_versions_channel_enum" AS ENUM('print', 'pdf', 'telegram')`,
    );
    await q.query(
      `CREATE TABLE "contract_versions" ("id" SERIAL NOT NULL, "contract_id" integer NOT NULL, "version" integer NOT NULL, "snapshot" jsonb NOT NULL, "issued_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "channel" "public"."contract_versions_channel_enum" NOT NULL, "issued_by" integer NOT NULL, CONSTRAINT "PK_contract_versions" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_contract_versions_contract_version" ON "contract_versions" ("contract_id", "version")`,
    );
    await q.query(
      `ALTER TABLE "contract_versions" ADD CONSTRAINT "FK_contract_versions_contract" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "contract_versions" ADD CONSTRAINT "FK_contract_versions_issued_by" FOREIGN KEY ("issued_by") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
    // Versiya - mijozga berilgan hujjat: o'zgartirish va o'chirish taqiqlangan
    await q.query(
      `CREATE OR REPLACE FUNCTION "contract_versions_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
       BEGIN
         RAISE EXCEPTION 'contract_versions: berilgan versiyani o''zgartirib yoki o''chirib bo''lmaydi';
       END $$`,
    );
    await q.query(
      `CREATE TRIGGER "trg_contract_versions_immutable" BEFORE UPDATE OR DELETE ON "contract_versions" FOR EACH ROW EXECUTE PROCEDURE "contract_versions_immutable"()`,
    );
    await q.query(
      `CREATE TRIGGER "trg_contract_versions_no_truncate" BEFORE TRUNCATE ON "contract_versions" FOR EACH STATEMENT EXECUTE PROCEDURE "contract_versions_immutable"()`,
    );

    await q.query(
      `CREATE TYPE "public"."cash_service_contract_links_item_type_enum" AS ENUM('flight', 'hotel', 'extra', 'insurance', 'visa')`,
    );
    await q.query(`CREATE TABLE "cash_service_contract_links" ("id" SERIAL NOT NULL, "cash_service_id" integer NOT NULL, "contract_id" integer NOT NULL, "item_type" "public"."cash_service_contract_links_item_type_enum" NOT NULL, "flight_id" integer, "hotel_id" integer, "extra_id" integer, CONSTRAINT "CHK_cscl_item" CHECK (("item_type" = 'flight' AND "flight_id" IS NOT NULL AND "hotel_id" IS NULL AND "extra_id" IS NULL)
  OR ("item_type" = 'hotel' AND "hotel_id" IS NOT NULL AND "flight_id" IS NULL AND "extra_id" IS NULL)
  OR ("item_type" = 'extra' AND "extra_id" IS NOT NULL AND "flight_id" IS NULL AND "hotel_id" IS NULL)
  OR ("item_type" IN ('insurance', 'visa') AND "flight_id" IS NULL AND "hotel_id" IS NULL AND "extra_id" IS NULL)), CONSTRAINT "PK_cash_service_contract_links" PRIMARY KEY ("id"))`);
    await q.query(
      `CREATE INDEX "IDX_cscl_contract_id" ON "cash_service_contract_links" ("contract_id")`,
    );
    await q.query(
      `CREATE INDEX "IDX_cscl_cash_service_id" ON "cash_service_contract_links" ("cash_service_id")`,
    );
    await q.query(
      `CREATE UNIQUE INDEX "UQ_cscl_item" ON "cash_service_contract_links" ("cash_service_id", "item_type", COALESCE("flight_id", "hotel_id", "extra_id", 0))`,
    );
    await q.query(
      `ALTER TABLE "cash_service_contract_links" ADD CONSTRAINT "FK_cscl_cash_service" FOREIGN KEY ("cash_service_id") REFERENCES "cash_services"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "cash_service_contract_links" ADD CONSTRAINT "FK_cscl_contract" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "cash_service_contract_links" ADD CONSTRAINT "FK_cscl_flight" FOREIGN KEY ("flight_id") REFERENCES "contract_flights"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "cash_service_contract_links" ADD CONSTRAINT "FK_cscl_hotel" FOREIGN KEY ("hotel_id") REFERENCES "contract_hotels"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await q.query(
      `ALTER TABLE "cash_service_contract_links" ADD CONSTRAINT "FK_cscl_extra" FOREIGN KEY ("extra_id") REFERENCES "contract_extras"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await q.query(
      `CREATE TABLE "contract_counter" ("id" smallint NOT NULL, "last_value" integer NOT NULL DEFAULT '0', CONSTRAINT "CHK_contract_counter_last_value" CHECK ("last_value" >= 0), CONSTRAINT "CHK_contract_counter_single_row" CHECK ("id" = 1), CONSTRAINT "PK_contract_counter" PRIMARY KEY ("id"))`,
    );
    await q.query(
      `INSERT INTO "contract_counter" ("id", "last_value") VALUES (1, 0) ON CONFLICT ("id") DO NOTHING`,
    );
  }

  /**
   * Qaytarish (faqat favqulodda; asosiy yo'l - zaxiradan tiklash). Shartnoma jadvallari o'chadi;
   * to'lov turlari eski ko'rinishga qaytadi: CARD_TRANSFER -> CARD (eski TRANSFER ajratib bo'lmaydi -
   * u ham CARD bo'ladi). Yangi turdagi (INSTALLMENT / BANK_ACCOUNT / TERMINAL) to'lov bo'lsa - TO'XTAYDI.
   */
  async down(q: QueryRunner): Promise<void> {
    const used = (await q.query(
      `SELECT count(*)::int AS n FROM "money" WHERE "type"::text IN ('INSTALLMENT', 'BANK_ACCOUNT', 'TERMINAL')`,
    )) as { n: number }[];
    if (used[0]?.n) {
      throw new Error(
        `Qaytarib bo'lmaydi: ${used[0].n} ta to'lov yangi turda (bo'lib to'lash / hisob raqam / terminal)`,
      );
    }
    await q.query(`DROP TABLE IF EXISTS "cash_service_contract_links"`);
    await q.query(`DROP TABLE IF EXISTS "contract_versions"`); // DROP TABLE trigger'ni chetlab o'tadi
    await q.query(`DROP FUNCTION IF EXISTS "contract_versions_immutable"()`);
    await q.query(`DROP TABLE IF EXISTS "contract_extras"`);
    await q.query(`DROP TABLE IF EXISTS "contract_hotels"`);
    await q.query(`DROP TABLE IF EXISTS "contract_flights"`);
    await q.query(`DROP TABLE IF EXISTS "contracts"`);
    await q.query(`DROP TABLE IF EXISTS "contract_counter"`);
    for (const t of [
      'cash_service_contract_links_item_type_enum',
      'contract_versions_channel_enum',
      'contract_extras_payment_mode_enum',
      'contract_hotels_transfer_route_enum',
      'contract_hotels_transfer_type_enum',
      'contract_hotels_meal_enum',
      'contract_hotels_placement_enum',
      'contracts_visa_enum',
      'contracts_insurance_enum',
      'contracts_lang_enum',
      'contracts_status_enum',
    ]) {
      await q.query(`DROP TYPE IF EXISTS "public"."${t}"`);
    }
    await q.query(
      `ALTER TABLE "money" DROP CONSTRAINT IF EXISTS "FK_money_provider"`,
    );
    await q.query(
      `ALTER TABLE "money" DROP CONSTRAINT IF EXISTS "CHK_money_installment_provider"`,
    );
    await q.query(`ALTER TABLE "money" DROP COLUMN IF EXISTS "provider_id"`);
    await q.query(`ALTER TABLE "money" DROP COLUMN IF EXISTS "source"`);
    await q.query(`DROP TYPE IF EXISTS "public"."money_source_enum"`);
    await q.query(`DROP TABLE IF EXISTS "installment_providers"`);
    await q.query(
      `ALTER TYPE "public"."money_type_enum" RENAME TO "money_type_enum_new"`,
    );
    await q.query(
      `CREATE TYPE "public"."money_type_enum" AS ENUM('CASH', 'CARD', 'TRANSFER')`,
    );
    await q.query(
      `ALTER TABLE "money" ALTER COLUMN "type" TYPE "public"."money_type_enum" USING (
         CASE "type"::text WHEN 'CARD_TRANSFER' THEN 'CARD' ELSE "type"::text END
       )::"public"."money_type_enum"`,
    );
    await q.query(`DROP TYPE "public"."money_type_enum_new"`);
  }
}
