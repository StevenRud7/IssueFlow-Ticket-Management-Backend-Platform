import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '../audit/entities/audit-action.enum';
import { AuditActor } from '../audit/entities/audit-actor.enum';
import { AuditEntity } from '../audit/entities/audit-entity.enum';
import { TicketsService } from '../tickets/tickets.service';
import { AttachmentsRepository } from './attachments.repository';
import {
  AttachmentResponse,
  toAttachmentResponse,
} from './entities/attachment.entity';

/**
 * Attachment management (§3.3).
 *
 * Files are stored on the local filesystem under UPLOAD_DIR; the database
 * holds only metadata. Each stored file gets a UUID `storageKey` as its
 * on-disk name — we never trust the user-supplied filename for the path,
 * which prevents path-traversal (a filename like "../../etc/passwd" can't
 * escape the upload directory because it's never used as a path).
 *
 * §3.3 constraints, enforced here as defence-in-depth (Multer also checks
 * at the controller layer):
 *   - Max size 10 MB — rejected with 400.
 *   - Allowed MIME types: image/png, image/jpeg, application/pdf,
 *     text/plain — everything else rejected with 400.
 *
 * Doing the checks in the service too (not just Multer) means the limits
 * hold even if the controller wiring changes, and the error messages are
 * consistent with the rest of the API.
 */
@Injectable()
export class AttachmentsService {
  /** §3.3: 10 MB hard cap. */
  static readonly MAX_BYTES = 10 * 1024 * 1024;

  /** §3.3: the only content types we accept. */
  static readonly ALLOWED_MIME = new Set<string>([
    'image/png',
    'image/jpeg',
    'application/pdf',
    'text/plain',
  ]);

  private readonly uploadDir: string;

  constructor(
    private readonly attachments: AttachmentsRepository,
    private readonly tickets: TicketsService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {
    this.uploadDir =
      this.config.get<string>('UPLOAD_DIR')?.trim() || './uploads';
  }

  /**
   * Validate and store an uploaded file against a ticket.
   *
   * `file` is the Express.Multer.File the controller hands us — buffer in
   * memory (Multer memory storage). We validate, then write to disk under
   * a fresh UUID key, then persist the metadata row.
   */
  async upload(
    ticketId: number,
    file: Express.Multer.File | undefined,
    uploaderId: number,
  ): Promise<AttachmentResponse> {
    if (!file) {
      throw new BadRequestException('No file was uploaded (field name: file)');
    }

    // §3.3 size check.
    if (file.size > AttachmentsService.MAX_BYTES) {
      throw new BadRequestException(
        `File exceeds the 10 MB limit (got ${file.size} bytes)`,
      );
    }

    // §3.3 MIME check.
    if (!AttachmentsService.ALLOWED_MIME.has(file.mimetype)) {
      throw new BadRequestException(
        `Unsupported file type "${file.mimetype}". Allowed: ${[...AttachmentsService.ALLOWED_MIME].join(', ')}`,
      );
    }

    // 404 if the ticket doesn't exist — checked AFTER cheap file validation
    // so a bad file fails fast without a DB round-trip.
    await this.tickets.assertExistsAndGet(ticketId);

    // Derive a safe on-disk name: UUID + the original extension (extension
    // only, never the full user filename).
    const ext = path.extname(file.originalname).slice(0, 16); // bound length
    const storageKey = `${uuidv4()}${ext}`;
    const fullPath = path.join(this.uploadDir, storageKey);

    await fs.mkdir(this.uploadDir, { recursive: true });
    await fs.writeFile(fullPath, file.buffer);

    let row;
    try {
      row = await this.attachments.create({
        ticketId,
        uploaderId,
        filename: file.originalname,
        contentType: file.mimetype,
        byteSize: file.size,
        storageKey,
      });
    } catch (err) {
      // If the metadata insert fails, don't leave an orphan file on disk.
      await fs.rm(fullPath, { force: true });
      throw err;
    }

    await this.audit.log({
      action: AuditAction.CREATE,
      entityType: AuditEntity.ATTACHMENT,
      entityId: Number(row.id),
      performedBy: uploaderId,
      actor: AuditActor.USER,
      metadata: {
        ticketId,
        filename: row.filename,
        contentType: row.content_type,
        byteSize: Number(row.byte_size),
      },
    });

    return toAttachmentResponse(row);
  }

  /**
   * List the attachments on a ticket. Not in the README's endpoint table,
   * but harmless and useful; the controller exposes it as a GET.
   */
  async listForTicket(ticketId: number): Promise<AttachmentResponse[]> {
    await this.tickets.assertExistsAndGet(ticketId);
    const rows = await this.attachments.findByTicket(ticketId);
    return rows.map(toAttachmentResponse);
  }

  /**
   * Delete an attachment: removes the metadata row AND the file on disk.
   * Enforces that the attachment actually belongs to the URL's ticket —
   * same cross-resource guard pattern as comments in Phase 5.
   */
  async delete(
    ticketId: number,
    attachmentId: number,
    performedBy: number,
  ): Promise<void> {
    const row = await this.attachments.findById(attachmentId);
    if (!row) {
      throw new NotFoundException(`Attachment ${attachmentId} not found`);
    }
    if (Number(row.ticket_id) !== ticketId) {
      throw new NotFoundException(
        `Attachment ${attachmentId} not found on ticket ${ticketId}`,
      );
    }

    await this.attachments.delete(attachmentId);

    // Best-effort file removal. If the file is already gone we don't care;
    // a failure here shouldn't fail the request since the metadata (the
    // authoritative record) is already deleted.
    const fullPath = path.join(this.uploadDir, row.storage_key);
    await fs.rm(fullPath, { force: true }).catch(() => undefined);

    await this.audit.log({
      action: AuditAction.DELETE,
      entityType: AuditEntity.ATTACHMENT,
      entityId: attachmentId,
      performedBy,
      actor: AuditActor.USER,
      metadata: { ticketId, filename: row.filename },
    });
  }
}
