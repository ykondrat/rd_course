import { Injectable, Logger } from '@nestjs/common';
import { CompleteMultipartUploadCommand, CreateMultipartUploadCommand } from '@aws-sdk/client-s3';

import { AppError } from '../common/problem';
import { DatabaseService } from '../database/database.service';
import { FileRow, FilesRepository } from './files.repository';
import { createStorage, headObject, listAllParts, presignGet, presignPart, presignPut, Storage } from './storage';
import {
  buildObjectKey,
  DOWNLOAD_URL_TTL_SECONDS,
  extensionFor,
  MAX_FILE_SIZE,
  needsMultipart,
  PART_URL_TTL_SECONDS,
  partCountFor,
  partSizeFor,
  PRESIGNED_PUT_TTL_SECONDS,
} from './upload-policy';

export interface IntentBody {
  filename: string;
  content_type: string;
  size: number;
}

export interface PartUrl {
  part_number: number;
  url: string;
}

export interface IntentResult {
  file_id: string;
  key: string;
  mode: 'single' | 'multipart';
  expires_in: number;
  url?: string;
  headers?: Record<string, string>;
  upload_id?: string;
  part_size?: number;
  part_count?: number;
  parts?: PartUrl[];
}

export interface PartsResult {
  file_id: string;
  part_size: number;
  part_count: number;
  uploaded: number[];
  missing: PartUrl[];
  expires_in: number;
}

export interface CommitResult {
  file_id: string;
  key: string;
  status: 'COMPLETED';
  size: number;
  etag: string;
}

@Injectable()
export class FilesService {
  private readonly logger = new Logger(FilesService.name);
  private storageInstance?: Storage;

  constructor(
    private readonly db: DatabaseService,
    private readonly files: FilesRepository,
  ) {}

  private get storage(): Storage {
    return (this.storageInstance ??= createStorage());
  }

  async intent(ownerId: number, body: IntentBody, idempotencyKey?: string): Promise<IntentResult> {
    const extension = extensionFor(body.content_type);

    if (!extension) throw new AppError(422, `Content type ${body.content_type} is not allowed.`, { code: 'content-type-not-allowed' });
    if (body.size > MAX_FILE_SIZE) throw new AppError(422, 'File is too large.', { code: 'file-too-large' });

    if (idempotencyKey) {
      const existing = await this.files.findByIdempotencyKey(this.db, ownerId, idempotencyKey);

      if (existing) return this.describe(existing);
    }

    const multipart = needsMultipart(body.size);
    const partSize = multipart ? partSizeFor(body.size) : null;
    const key = buildObjectKey(ownerId, extension);
    const row = await this.files.insertPending(this.db, {
      key,
      ownerId,
      contentType: body.content_type,
      size: body.size,
      partSize,
      idempotencyKey: idempotencyKey ?? null,
    });

    if (!row) return this.describe((await this.files.findByIdempotencyKey(this.db, ownerId, idempotencyKey as string)) as FileRow);
    if (multipart) {
      const created = await this.storage.s3.send(
        new CreateMultipartUploadCommand({ Bucket: this.storage.bucket, Key: key, ContentType: body.content_type }),
      );

      await this.files.setUploadId(this.db, row.id, String(created.UploadId));
      row.upload_id = String(created.UploadId);
    }

    this.logger.log(`intent file=${row.id} key=${key} mode=${multipart ? 'multipart' : 'single'}`);

    return this.describe(row);
  }

  async parts(ownerId: number, fileId: string): Promise<PartsResult> {
    const row = await this.ownedOrThrow(ownerId, fileId);

    if (!row.upload_id || !row.part_size) throw new AppError(409, 'File is not a multipart upload.', { code: 'not-multipart' });
    if (row.status === 'COMPLETED') throw new AppError(409, 'Upload is already completed.', { code: 'already-completed' });

    const partCount = partCountFor(row.size, row.part_size);
    const uploaded = await listAllParts(this.storage, row.key, row.upload_id);
    const uploadedNumbers = new Set(uploaded.map((part) => part.partNumber));
    const missingNumbers = Array.from({ length: partCount }, (_, index) => index + 1).filter((number) => !uploadedNumbers.has(number));
    const missing = await this.signParts(row.key, row.upload_id, missingNumbers);

    return {
      file_id: row.id,
      part_size: row.part_size,
      part_count: partCount,
      uploaded: [...uploadedNumbers].sort((left, right) => left - right),
      missing,
      expires_in: PART_URL_TTL_SECONDS,
    };
  }

  async commit(ownerId: number, fileId: string): Promise<CommitResult> {
    const row = await this.ownedOrThrow(ownerId, fileId);

    if (row.status === 'COMPLETED') return this.toCommitResult(row, row.size, String(row.etag));
    if (row.upload_id && row.part_size) await this.completeMultipart(row);

    const head = await headObject(this.storage, row.key);

    if (head.status !== 200) throw new AppError(409, 'Object is not in storage — nothing to commit.', { code: 'object-missing' });
    if (head.size !== row.size) throw new AppError(409, `Size mismatch: expected ${row.size}, got ${head.size}.`, { code: 'size-mismatch' });

    const completed = await this.files.markCompleted(this.db, row.id, String(head.etag));

    this.logger.log(`commit file=${row.id} key=${row.key} size=${head.size}`);

    return this.toCommitResult(completed, head.size, String(head.etag));
  }

  async downloadUrl(ownerId: number, fileId: string): Promise<string> {
    const row = await this.ownedOrThrow(ownerId, fileId);

    if (row.status !== 'COMPLETED') throw new AppError(409, 'File upload is not completed.', { code: 'not-completed' });

    return presignGet(this.storage, row.key, DOWNLOAD_URL_TTL_SECONDS);
  }

  private async completeMultipart(row: FileRow): Promise<void> {
    const partCount = partCountFor(row.size, Number(row.part_size));
    const parts = await listAllParts(this.storage, row.key, String(row.upload_id));

    if (parts.length !== partCount) {
      throw new AppError(409, `Only ${parts.length} of ${partCount} parts are uploaded.`, { code: 'parts-missing' });
    }

    await this.storage.s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: this.storage.bucket,
        Key: row.key,
        UploadId: String(row.upload_id),
        MultipartUpload: { Parts: parts.map((part) => ({ PartNumber: part.partNumber, ETag: part.etag })) },
      }),
    );
  }

  private async describe(row: FileRow): Promise<IntentResult> {
    if (row.upload_id && row.part_size) {
      const state = await this.parts(row.owner_id, row.id);

      return {
        file_id: row.id,
        key: row.key,
        mode: 'multipart',
        expires_in: PART_URL_TTL_SECONDS,
        upload_id: row.upload_id,
        part_size: row.part_size,
        part_count: state.part_count,
        parts: state.missing,
      };
    }

    const url = await presignPut(this.storage, row.key, row.content_type, row.size, PRESIGNED_PUT_TTL_SECONDS);

    return {
      file_id: row.id,
      key: row.key,
      mode: 'single',
      expires_in: PRESIGNED_PUT_TTL_SECONDS,
      url,
      headers: { 'content-type': row.content_type },
    };
  }

  private signParts(key: string, uploadId: string, partNumbers: number[]): Promise<PartUrl[]> {
    return Promise.all(
      partNumbers.map(async (partNumber) => ({
        part_number: partNumber,
        url: await presignPart(this.storage, key, uploadId, partNumber, PART_URL_TTL_SECONDS),
      })),
    );
  }

  private async ownedOrThrow(ownerId: number, fileId: string): Promise<FileRow> {
    const row = await this.files.findOwned(this.db, ownerId, fileId);

    if (!row) throw new AppError(404, 'File not found.', { code: 'file-not-found' });

    return row;
  }

  private toCommitResult(row: FileRow, size: number, etag: string): CommitResult {
    return { file_id: row.id, key: row.key, status: 'COMPLETED', size, etag };
  }
}