import { MigrationInterface, QueryRunner } from "typeorm";

export class AddReviews1793000000000 implements MigrationInterface {
    name = 'AddReviews1793000000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE "reviews" ("id" bigint GENERATED ALWAYS AS IDENTITY NOT NULL, "product_id" bigint NOT NULL, "rating" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "reviews_rating_check" CHECK ("rating" BETWEEN 1 AND 5), CONSTRAINT "PK_reviews_id" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "reviews_product_idx" ON "reviews" ("product_id")`);
        await queryRunner.query(`ALTER TABLE "reviews" ADD CONSTRAINT "FK_reviews_product" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`DO $$ BEGIN IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'app_user') THEN GRANT SELECT, INSERT, UPDATE, DELETE ON "reviews" TO app_user; END IF; END $$;`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "reviews" DROP CONSTRAINT "FK_reviews_product"`);
        await queryRunner.query(`DROP INDEX "public"."reviews_product_idx"`);
        await queryRunner.query(`DROP TABLE "reviews"`);
    }
}