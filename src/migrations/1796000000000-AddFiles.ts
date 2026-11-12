import { MigrationInterface, QueryRunner } from "typeorm";

export class AddFiles1796000000000 implements MigrationInterface {
    name = 'AddFiles1796000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "files" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "key" text NOT NULL, "owner_id" bigint NOT NULL, "status" text NOT NULL DEFAULT 'PENDING', "content_type" text NOT NULL, "size" bigint NOT NULL, "upload_id" text, "part_size" bigint, "idempotency_key" text, "etag" text, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "completed_at" TIMESTAMP WITH TIME ZONE, CONSTRAINT "PK_files_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`ALTER TABLE "files" ADD CONSTRAINT "files_status_check" CHECK ("status" IN ('PENDING', 'COMPLETED'))`);
        await queryRunner.query(`ALTER TABLE "files" ADD CONSTRAINT "files_size_check" CHECK ("size" > 0)`);
        await queryRunner.query(`CREATE UNIQUE INDEX "files_key_uq" ON "files" ("key")`);
        await queryRunner.query(`CREATE UNIQUE INDEX "files_owner_idempotency_uq" ON "files" ("owner_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL`);
        await queryRunner.query(`CREATE INDEX "files_pending_created_ix" ON "files" ("created_at") WHERE "status" = 'PENDING'`);
        await queryRunner.query(`ALTER TABLE "files" ADD CONSTRAINT "FK_files_owner" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON "files" TO app_user; END IF; END $$;`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "files" DROP CONSTRAINT "FK_files_owner"`);
        await queryRunner.query(`DROP TABLE "files"`);
    }
}