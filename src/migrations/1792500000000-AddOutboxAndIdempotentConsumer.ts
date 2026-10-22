import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOutboxAndIdempotentConsumer1792500000000 implements MigrationInterface {
    name = 'AddOutboxAndIdempotentConsumer1792500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "outbox" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "aggregate_type" text NOT NULL, "aggregate_id" text NOT NULL, "type" text NOT NULL, "payload" jsonb NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "published_at" TIMESTAMP WITH TIME ZONE, "attempts" integer NOT NULL DEFAULT '0', CONSTRAINT "outbox_attempts_check" CHECK ("attempts" >= 0), CONSTRAINT "PK_outbox_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "outbox_unpublished_idx" ON "outbox" ("created_at") WHERE "published_at" IS NULL`);
        await queryRunner.query(`CREATE TABLE "processed_messages" ("message_id" text NOT NULL, "consumer" text NOT NULL, "processed_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_processed_messages" PRIMARY KEY ("message_id", "consumer"))`);
        await queryRunner.query(`CREATE TABLE "order_fulfillments" ("order_id" bigint NOT NULL, "fulfilled_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_order_fulfillments" PRIMARY KEY ("order_id"))`);
        await queryRunner.query(`ALTER TABLE "order_fulfillments" ADD CONSTRAINT "FK_order_fulfillments_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON "outbox" TO app_user; GRANT SELECT, INSERT ON "processed_messages" TO app_user; GRANT SELECT, INSERT, UPDATE ON "order_fulfillments" TO app_user; END IF; END $$;`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "order_fulfillments" DROP CONSTRAINT "FK_order_fulfillments_order"`);
        await queryRunner.query(`DROP TABLE "order_fulfillments"`);
        await queryRunner.query(`DROP TABLE "processed_messages"`);
        await queryRunner.query(`DROP INDEX "public"."outbox_unpublished_idx"`);
        await queryRunner.query(`DROP TABLE "outbox"`);
    }
}
