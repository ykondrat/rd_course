import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAuth1794000000000 implements MigrationInterface {
    name = 'AddAuth1794000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "role" text NOT NULL DEFAULT 'customer'`);
        await queryRunner.query(`ALTER TABLE "users" ADD "password_hash" text NOT NULL DEFAULT ''`);
        await queryRunner.query(`ALTER TABLE "users" ADD "is_active" boolean NOT NULL DEFAULT true`);
        await queryRunner.query(`ALTER TABLE "users" ADD CONSTRAINT "users_role_check" CHECK ("role" IN ('customer', 'seller', 'admin'))`);

        await queryRunner.query(`CREATE TABLE "refresh_tokens" ("id" uuid NOT NULL DEFAULT gen_random_uuid(), "family_id" uuid NOT NULL, "user_id" bigint NOT NULL, "token_hash" text NOT NULL, "used_at" TIMESTAMP WITH TIME ZONE, "revoked_at" TIMESTAMP WITH TIME ZONE, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_refresh_tokens_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE UNIQUE INDEX "refresh_tokens_hash_uq" ON "refresh_tokens" ("token_hash")`);
        await queryRunner.query(`CREATE INDEX "refresh_tokens_family_live_ix" ON "refresh_tokens" ("family_id") WHERE "revoked_at" IS NULL`);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD CONSTRAINT "FK_refresh_tokens_user" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);

        await queryRunner.query(`CREATE TABLE "access_denylist" ("jti" text NOT NULL, "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL, CONSTRAINT "PK_access_denylist_jti" PRIMARY KEY ("jti"))`);
        await queryRunner.query(`CREATE INDEX "access_denylist_expires_ix" ON "access_denylist" ("expires_at")`);

        await queryRunner.query(`DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON "refresh_tokens" TO app_user; GRANT SELECT, INSERT, DELETE ON "access_denylist" TO app_user; GRANT SELECT, UPDATE ON "users" TO app_user; END IF; END $$;`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE "access_denylist"`);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP CONSTRAINT "FK_refresh_tokens_user"`);
        await queryRunner.query(`DROP TABLE "refresh_tokens"`);
        await queryRunner.query(`ALTER TABLE "users" DROP CONSTRAINT "users_role_check"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "is_active"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "password_hash"`);
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "role"`);
    }
}