import { Queryable } from '../../../src/common/queryable';
import { ProductRow, ProductsRepository } from '../../../src/products/products.repository';

let seq = 0;

export class ProductBuilder {
  private title = 'Test product';
  private priceCents = 1999;
  private currency = 'USD';
  private sku = `SKU-${++seq}`;
  private description: string | undefined;

  withTitle(title: string): this {
    this.title = title;
    return this;
  }

  withPriceCents(priceCents: number): this {
    this.priceCents = priceCents;
    return this;
  }

  withCurrency(currency: string): this {
    this.currency = currency;
    return this;
  }

  withSku(sku: string): this {
    this.sku = sku;
    return this;
  }

  withDescription(description: string): this {
    this.description = description;
    return this;
  }

  build(): { title: string; price_cents: number; currency: string; sku: string; description?: string } {
    return {
      title: this.title,
      price_cents: this.priceCents,
      currency: this.currency,
      sku: this.sku,
      description: this.description,
    };
  }

  async insertVia(repo: ProductsRepository, db: Queryable): Promise<ProductRow> {
    return repo.insert(db, this.build());
  }
}

export const aProduct = (): ProductBuilder => new ProductBuilder();

export interface UserRow {
  id: number;
  email: string;
  full_name: string;
}

export class UserBuilder {
  private email = `user-${++seq}@example.com`;
  private fullName = 'Test User';

  withEmail(email: string): this {
    this.email = email;
    return this;
  }

  withFullName(fullName: string): this {
    this.fullName = fullName;
    return this;
  }

  build(): { email: string; full_name: string } {
    return { email: this.email, full_name: this.fullName };
  }

  async insertVia(db: Queryable): Promise<UserRow> {
    const { rows } = await db.query(
      `INSERT INTO users (email, full_name) VALUES ($1, $2) RETURNING id, email, full_name`,
      [this.email, this.fullName],
    );

    return rows[0] as UserRow;
  }
}

export const aUser = (): UserBuilder => new UserBuilder();
