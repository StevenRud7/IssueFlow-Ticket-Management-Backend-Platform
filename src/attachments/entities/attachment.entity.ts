/**
 * Shape of an `attachments` row from pg. The raw bytes live on disk under
 * UPLOAD_DIR keyed by `storage_key`; only metadata is in the database.
 */
export interface AttachmentRow {
  id: number;
  ticket_id: number;
  uploader_id: number;
  filename: string;
  content_type: string;
  byte_size: number;
  storage_key: string;
  created_at: Date;
}

/**
 * Public-facing shape. Matches the README contract:
 *   { "id": 1, "ticketId": 1, "filename": "screenshot.png",
 *     "contentType": "image/png" }
 *
 * We also include `byteSize` — useful and harmless (the contract example
 * doesn't forbid extra fields). `storageKey` is deliberately NOT exposed:
 * it's an internal on-disk filename and leaking it serves no purpose.
 */
export interface AttachmentResponse {
  id: number;
  ticketId: number;
  filename: string;
  contentType: string;
  byteSize: number;
}

export function toAttachmentResponse(row: AttachmentRow): AttachmentResponse {
  return {
    id: Number(row.id),
    ticketId: Number(row.ticket_id),
    filename: row.filename,
    contentType: row.content_type,
    byteSize: Number(row.byte_size),
  };
}
