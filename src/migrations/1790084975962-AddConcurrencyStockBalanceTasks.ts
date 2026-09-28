import { MigrationInterface, QueryRunner } from "typeorm";

export class AddConcurrencyStockBalanceTasks1790084975962 implements MigrationInterface {
    name = 'AddConcurrencyStockBalanceTasks1790084975962'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "tasks" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "type" text NOT NULL, "payload" jsonb, "status" text NOT NULL DEFAULT 'pending', "processed" integer NOT NULL DEFAULT '0', "worker_id" text, "result" jsonb, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "processed_at" TIMESTAMP WITH TIME ZONE, "order_id" bigint, CONSTRAINT "tasks_processed_check" CHECK ("processed" >= 0), CONSTRAINT "tasks_status_check" CHECK (status IN ('pending', 'done', 'failed')), CONSTRAINT "PK_8d12ff38fcc62aaba2cab748772" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "tasks_status_idx" ON "tasks" ("status") `);
        await queryRunner.query(`ALTER TABLE "products" ADD "stock" integer NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "users" ADD "balance_cents" bigint NOT NULL DEFAULT '0'`);
        await queryRunner.query(`ALTER TABLE "products" ADD CONSTRAINT "products_stock_check" CHECK ("stock" >= 0)`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "users_balance_cents_check" CHECK ("balance_cents" >= 0)`);
        await queryRunner.query(`ALTER TABLE "tasks" ADD CONSTRAINT "FK_ebc795fe637f4e8c0cfcb392e59" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "tasks" DROP CONSTRAINT "FK_ebc795fe637f4e8c0cfcb392e59"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "users_balance_cents_check"`);
        await queryRunner.query(`ALTER TABLE "products" DROP CONSTRAINT "products_stock_check"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "balance_cents"`);
        await queryRunner.query(`ALTER TABLE "products" DROP COLUMN "stock"`);
        await queryRunner.query(`DROP INDEX "public"."tasks_status_idx"`);
        await queryRunner.query(`DROP TABLE "tasks"`);
    }

}
