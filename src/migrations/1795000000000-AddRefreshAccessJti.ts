import { MigrationInterface, QueryRunner } from "typeorm";

export class AddRefreshAccessJti1795000000000 implements MigrationInterface {
    name = 'AddRefreshAccessJti1795000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD "access_jti" text`);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" ADD "access_expires_at" TIMESTAMP WITH TIME ZONE`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP COLUMN "access_expires_at"`);
        await queryRunner.query(`ALTER TABLE "refresh_tokens" DROP COLUMN "access_jti"`);
    }
}