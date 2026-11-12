import { Injectable } from '@nestjs/common';

import { Queryable } from '../common/queryable';

export interface FileRow {
  id: string;
  key: string;
  owner_id: number;
  status: 'PENDING' | 'COMPLETED';
  content_type: string;
  size: number;
  upload_id: string | null;
  part_size: number | null;
  etag: string | null;
}

export interface NewFile {
  key: string;
  ownerId: number;
  contentType: string;
  size: number;
  partSize: number | null;
  idempotencyKey: string | null;
}

const COLUMNS = `id, key, owner_id, status, content_type, size, upload_id, part_size, etag`;

@Injectable()
export class FilesRepository {
  async insertPending(db: Queryable, file: NewFile): Promise<FileRow | null> {
    const result = await db.query(
      `INSERT INTO files (key, owner_id, content_type, size, part_size, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (owner_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
       RETURNING ${COLUMNS}`,
      [file.key, file.ownerId, file.contentType, file.size, file.partSize, file.idempotencyKey],
    );

    return (result.rows[0] as FileRow | undefined) ?? null;
  }

  async findByIdempotencyKey(db: Queryable, ownerId: number, idempotencyKey: string): Promise<FileRow | null> {
    const result = await db.query(
      `SELECT ${COLUMNS} FROM files WHERE owner_id = $1 AND idempotency_key = $2`,
      [ownerId, idempotencyKey],
    );

    return (result.rows[0] as FileRow | undefined) ?? null;
  }

  async findOwned(db: Queryable, ownerId: number, fileId: string): Promise<FileRow | null> {
    const result = await db.query(`SELECT ${COLUMNS} FROM files WHERE id = $1 AND owner_id = $2`, [fileId, ownerId]);

    return (result.rows[0] as FileRow | undefined) ?? null;
  }

  async setUploadId(db: Queryable, fileId: string, uploadId: string): Promise<void> {
    await db.query(`UPDATE files SET upload_id = $2 WHERE id = $1`, [fileId, uploadId]);
  }

  async markCompleted(db: Queryable, fileId: string, etag: string): Promise<FileRow> {
    const result = await db.query(
      `UPDATE files SET status = 'COMPLETED', etag = $2, completed_at = now()
        WHERE id = $1 RETURNING ${COLUMNS}`,
      [fileId, etag],
    );

    return result.rows[0] as FileRow;
  }
}