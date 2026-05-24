import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { AttachmentRow } from './entities/attachment.entity';

/**
 * SQL for the `attachments` table. Stores only file metadata — the bytes
 * are written to disk by AttachmentsService.
 */
@Injectable()
export class AttachmentsRepository {
  private static readonly COLUMNS = `
    id, ticket_id, uploader_id, filename, content_type,
    byte_size, storage_key, created_at
  `;

  constructor(private readonly db: DatabaseService) {}

  async create(input: {
    ticketId: number;
    uploaderId: number;
    filename: string;
    contentType: string;
    byteSize: number;
    storageKey: string;
  }): Promise<AttachmentRow> {
    const { rows } = await this.db.query<AttachmentRow>(
      `INSERT INTO attachments
              (ticket_id, uploader_id, filename, content_type,
               byte_size, storage_key)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${AttachmentsRepository.COLUMNS}`,
      [
        input.ticketId,
        input.uploaderId,
        input.filename,
        input.contentType,
        input.byteSize,
        input.storageKey,
      ],
    );
    return rows[0];
  }

  async findById(id: number): Promise<AttachmentRow | null> {
    const { rows } = await this.db.query<AttachmentRow>(
      `SELECT ${AttachmentsRepository.COLUMNS}
         FROM attachments
        WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async findByTicket(ticketId: number): Promise<AttachmentRow[]> {
    const { rows } = await this.db.query<AttachmentRow>(
      `SELECT ${AttachmentsRepository.COLUMNS}
         FROM attachments
        WHERE ticket_id = $1
        ORDER BY id ASC`,
      [ticketId],
    );
    return rows;
  }

  async delete(id: number): Promise<boolean> {
    const result = await this.db.query(
      `DELETE FROM attachments WHERE id = $1`,
      [id],
    );
    return (result.rowCount ?? 0) > 0;
  }
}
