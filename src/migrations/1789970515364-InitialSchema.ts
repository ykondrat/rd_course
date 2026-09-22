import { MigrationInterface, QueryRunner } from "typeorm";

export class InitialSchema1789970515364 implements MigrationInterface {
    name = 'InitialSchema1789970515364'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "products" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "title" text NOT NULL, "price_cents" bigint NOT NULL, "currency" text NOT NULL, "sku" text NOT NULL, "description" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "products_currency_check" CHECK (currency ~ '^[A-Z]{3}$'), CONSTRAINT "products_price_cents_check" CHECK ("price_cents" >= 0), CONSTRAINT "PK_0806c755e0aca124e67c0cf6d7d" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "order_items" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "quantity" integer NOT NULL, "unit_price_cents" bigint NOT NULL, "line_total_cents" bigint NOT NULL, "order_id" bigint NOT NULL, "product_id" bigint NOT NULL, CONSTRAINT "order_items_line_total_cents_check" CHECK ("line_total_cents" >= 0), CONSTRAINT "order_items_unit_price_cents_check" CHECK ("unit_price_cents" >= 0), CONSTRAINT "order_items_quantity_check" CHECK (quantity >= 1), CONSTRAINT "PK_005269d8574e6fac0493715c308" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "orders" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "currency" text NOT NULL, "total_cents" bigint NOT NULL, "status" text NOT NULL DEFAULT 'new', "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "user_id" bigint NOT NULL, CONSTRAINT "orders_status_check" CHECK (status IN ('new', 'paid', 'shipped')), CONSTRAINT "orders_total_cents_check" CHECK ("total_cents" >= 0), CONSTRAINT "orders_currency_check" CHECK (currency ~ '^[A-Z]{3}$'), CONSTRAINT "PK_710e2d4957aa5878dfe94e4ac2f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "orders_user_created_idx" ON "orders" ("user_id", "created_at") `);
        await queryRunner.query(`CREATE TABLE "users" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "email" text NOT NULL, "full_name" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3" UNIQUE ("email"), CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "idempotency_keys" ("key" text NOT NULL, "fingerprint" text NOT NULL, "state" text NOT NULL, "response" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_0afd83cbf08c9d12089a9bffc5e" PRIMARY KEY ("key"))`);

        await queryRunner.query(`CREATE INDEX "orders_shipped_recent_idx" ON "orders" ("created_at" DESC) WHERE status = 'shipped'`);
        await queryRunner.query(`CREATE INDEX "products_sku_lower_idx" ON "products" (lower("sku"))`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "FK_145532db85752b29c57d2b7b1f1" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "order_items" ADD CONSTRAINT "FK_9263386c35b6b242540f9493b00" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "orders" ADD CONSTRAINT "FK_a922b820eeef29ac1c6800e826a" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "orders" DROP CONSTRAINT "FK_a922b820eeef29ac1c6800e826a"`);
        await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_9263386c35b6b242540f9493b00"`);
        await queryRunner.query(`ALTER TABLE "order_items" DROP CONSTRAINT "FK_145532db85752b29c57d2b7b1f1"`);

        await queryRunner.query(`DROP INDEX "public"."products_sku_lower_idx"`);
        await queryRunner.query(`DROP INDEX "public"."orders_shipped_recent_idx"`);
        await queryRunner.query(`DROP TABLE "idempotency_keys"`);
        await queryRunner.query(`DROP TABLE "users"`);
        await queryRunner.query(`DROP INDEX "public"."orders_user_created_idx"`);
        await queryRunner.query(`DROP TABLE "orders"`);
        await queryRunner.query(`DROP TABLE "order_items"`);
        await queryRunner.query(`DROP TABLE "products"`);
    }
}
