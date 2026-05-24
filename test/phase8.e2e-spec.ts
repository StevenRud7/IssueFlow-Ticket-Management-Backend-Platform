import request from 'supertest';
import { bootstrapTestApp, resetDatabase, TestContext } from './utils/e2e-app';
import {
  createProject,
  createTicket,
  registerAndLogin,
} from './utils/fixtures';

/**
 * E2E — Soft-Delete management (§3.5), Attachments (§3.3), and CSV
 * Export/Import (§3.4).
 *
 * Covers the ADMIN-gated restore endpoints, multipart file upload with
 * MIME/size validation, and the CSV round-trip including per-row import
 * error handling.
 */
describe('Soft-Delete + Attachments + CSV (e2e)', () => {
  let ctx: TestContext;
  let adminAuth: string;
  let devAuth: string;
  let adminId: number;
  let devUserId: number;
  let projectId: number;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.db);
    const admin = await registerAndLogin(ctx.server, 'admin', 'ADMIN');
    const dev = await registerAndLogin(ctx.server, 'dev', 'DEVELOPER');
    adminAuth = admin.auth;
    devAuth = dev.auth;
    adminId = admin.user.id;
    devUserId = dev.user.id;
    projectId = await createProject(ctx.server, adminAuth, 'P', adminId);
  });

  // ---- Soft-delete management (§3.5) -------------------------------------

  describe('soft-delete management', () => {
    it('hides a soft-deleted ticket from the normal list', async () => {
      const t = (
        await createTicket(ctx.server, adminAuth, projectId, 'T').expect(200)
      ).body;

      await request(ctx.server)
        .delete(`/tickets/${t.id}`)
        .set('Authorization', adminAuth)
        .expect(200);

      const list = await request(ctx.server)
        .get(`/tickets?projectId=${projectId}`)
        .set('Authorization', adminAuth)
        .expect(200);
      expect(list.body).toHaveLength(0);
    });

    it('lists soft-deleted tickets for an ADMIN', async () => {
      const t = (
        await createTicket(ctx.server, adminAuth, projectId, 'T').expect(200)
      ).body;
      await request(ctx.server)
        .delete(`/tickets/${t.id}`)
        .set('Authorization', adminAuth)
        .expect(200);

      const res = await request(ctx.server)
        .get(`/tickets/deleted?projectId=${projectId}`)
        .set('Authorization', adminAuth)
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(t.id);
    });

    it('rejects GET /tickets/deleted for a non-ADMIN with 403', async () => {
      await request(ctx.server)
        .get(`/tickets/deleted?projectId=${projectId}`)
        .set('Authorization', devAuth)
        .expect(403);
    });

    it('restores a soft-deleted ticket (ADMIN), then 409 on a second restore', async () => {
      const t = (
        await createTicket(ctx.server, adminAuth, projectId, 'T').expect(200)
      ).body;
      await request(ctx.server)
        .delete(`/tickets/${t.id}`)
        .set('Authorization', adminAuth)
        .expect(200);

      await request(ctx.server)
        .post(`/tickets/${t.id}/restore`)
        .set('Authorization', adminAuth)
        .expect(200);

      // ticket is visible again
      const list = await request(ctx.server)
        .get(`/tickets?projectId=${projectId}`)
        .set('Authorization', adminAuth)
        .expect(200);
      expect(list.body).toHaveLength(1);

      // restoring an already-active ticket → 409
      await request(ctx.server)
        .post(`/tickets/${t.id}/restore`)
        .set('Authorization', adminAuth)
        .expect(409);
    });

    it('rejects ticket restore for a non-ADMIN with 403', async () => {
      const t = (
        await createTicket(ctx.server, adminAuth, projectId, 'T').expect(200)
      ).body;
      await request(ctx.server)
        .delete(`/tickets/${t.id}`)
        .set('Authorization', adminAuth)
        .expect(200);
      await request(ctx.server)
        .post(`/tickets/${t.id}/restore`)
        .set('Authorization', devAuth)
        .expect(403);
    });

    it('soft-deletes and restores a project', async () => {
      const pid = await createProject(ctx.server, adminAuth, 'Temp', adminId);
      await request(ctx.server)
        .delete(`/projects/${pid}`)
        .set('Authorization', adminAuth)
        .expect(200);

      const deletedList = await request(ctx.server)
        .get('/projects/deleted')
        .set('Authorization', adminAuth)
        .expect(200);
      expect(deletedList.body.some((p: { id: number }) => p.id === pid)).toBe(
        true,
      );

      await request(ctx.server)
        .post(`/projects/${pid}/restore`)
        .set('Authorization', adminAuth)
        .expect(200);
    });
  });

  // ---- Attachments (§3.3) -------------------------------------------------

  describe('attachments', () => {
    let ticketId: number;

    beforeEach(async () => {
      ticketId = (
        await createTicket(ctx.server, adminAuth, projectId, 'T').expect(200)
      ).body.id;
    });

    it('uploads a valid PNG and returns metadata', async () => {
      const res = await request(ctx.server)
        .post(`/tickets/${ticketId}/attachments`)
        .set('Authorization', adminAuth)
        .attach('file', Buffer.from('fake-png-bytes'), {
          filename: 'screenshot.png',
          contentType: 'image/png',
        })
        .expect(200);

      expect(res.body).toMatchObject({
        id: expect.any(Number),
        ticketId,
        filename: 'screenshot.png',
        contentType: 'image/png',
      });
    });

    it('rejects a disallowed MIME type with 400', async () => {
      await request(ctx.server)
        .post(`/tickets/${ticketId}/attachments`)
        .set('Authorization', adminAuth)
        .attach('file', Buffer.from('MZ-executable'), {
          filename: 'virus.exe',
          contentType: 'application/x-msdownload',
        })
        .expect(400);
    });

    it('404s when uploading to a non-existent ticket', async () => {
      await request(ctx.server)
        .post('/tickets/99999/attachments')
        .set('Authorization', adminAuth)
        .attach('file', Buffer.from('data'), {
          filename: 'a.png',
          contentType: 'image/png',
        })
        .expect(404);
    });

    it('lists and deletes attachments', async () => {
      const created = await request(ctx.server)
        .post(`/tickets/${ticketId}/attachments`)
        .set('Authorization', adminAuth)
        .attach('file', Buffer.from('pdf-bytes'), {
          filename: 'doc.pdf',
          contentType: 'application/pdf',
        })
        .expect(200);

      const list = await request(ctx.server)
        .get(`/tickets/${ticketId}/attachments`)
        .set('Authorization', adminAuth)
        .expect(200);
      expect(list.body).toHaveLength(1);

      await request(ctx.server)
        .delete(`/tickets/${ticketId}/attachments/${created.body.id}`)
        .set('Authorization', adminAuth)
        .expect(200);

      const after = await request(ctx.server)
        .get(`/tickets/${ticketId}/attachments`)
        .set('Authorization', adminAuth)
        .expect(200);
      expect(after.body).toHaveLength(0);
    });

    it('404s when deleting an attachment via the wrong ticket', async () => {
      const other = (
        await createTicket(ctx.server, adminAuth, projectId, 'other').expect(
          200,
        )
      ).body.id;
      const created = await request(ctx.server)
        .post(`/tickets/${ticketId}/attachments`)
        .set('Authorization', adminAuth)
        .attach('file', Buffer.from('x'), {
          filename: 'a.txt',
          contentType: 'text/plain',
        })
        .expect(200);

      await request(ctx.server)
        .delete(`/tickets/${other}/attachments/${created.body.id}`)
        .set('Authorization', adminAuth)
        .expect(404);
    });
  });

  // ---- CSV Export / Import (§3.4) ----------------------------------------

  describe('CSV export/import', () => {
    it('exports tickets as CSV with a header row and correct quoting', async () => {
      await createTicket(
        ctx.server,
        adminAuth,
        projectId,
        'Plain title',
      ).expect(200);
      await createTicket(ctx.server, adminAuth, projectId, 'Title, comma', {
        description: 'has "quotes"',
      }).expect(200);

      const res = await request(ctx.server)
        .get(`/tickets/export?projectId=${projectId}`)
        .set('Authorization', adminAuth)
        .expect(200);

      expect(res.headers['content-type']).toContain('text/csv');
      expect(res.headers['content-disposition']).toContain('attachment');
      const lines = res.text.trim().split('\n');
      expect(lines[0]).toBe(
        'id,title,description,status,priority,type,assigneeId',
      );
      // comma-bearing field is quoted; embedded quotes are doubled
      expect(res.text).toContain('"Title, comma"');
      expect(res.text).toContain('""quotes""');
    });

    it('exports every required field with the correct value in each column', async () => {
      // Create a ticket with explicit, distinct values for each field so
      // we can assert they land in the right CSV columns (§3.4 requires
      // exactly: id, title, description, status, priority, type, assigneeId).
      const created = (
        await createTicket(ctx.server, adminAuth, projectId, 'Field check', {
          description: 'verifying columns',
          priority: 'HIGH',
          assigneeId: devUserId,
        }).expect(200)
      ).body;

      const res = await request(ctx.server)
        .get(`/tickets/export?projectId=${projectId}`)
        .set('Authorization', adminAuth)
        .expect(200);

      const lines = res.text.trim().split('\n');
      expect(lines[0]).toBe(
        'id,title,description,status,priority,type,assigneeId',
      );
      // find this ticket's row and split it into the 7 columns
      const row = lines.find((l) => l.startsWith(`${created.id},`));
      expect(row).toBeDefined();
      const cols = (row as string).split(',');
      expect(cols).toHaveLength(7);
      expect(cols[0]).toBe(String(created.id)); // id
      expect(cols[1]).toBe('Field check'); // title
      expect(cols[2]).toBe('verifying columns'); // description
      expect(cols[3]).toBe('TODO'); // status (default)
      expect(cols[4]).toBe('HIGH'); // priority
      expect(cols[5]).toBe('BUG'); // type
      expect(cols[6]).toBe(String(devUserId)); // assigneeId
    });

    it('renders an unassigned ticket with a blank assigneeId column', async () => {
      // Create a ticket, then null its assignee directly in the DB so the
      // state is deterministic (auto-assignment may otherwise pick any
      // DEVELOPER). This isolates what we're checking: an unassigned
      // ticket must export with an empty assigneeId column.
      const created = (
        await createTicket(
          ctx.server,
          adminAuth,
          projectId,
          'Unassigned one',
        ).expect(200)
      ).body;
      await ctx.db.query(
        'UPDATE tickets SET assignee_id = NULL WHERE id = $1',
        [created.id],
      );

      const res = await request(ctx.server)
        .get(`/tickets/export?projectId=${projectId}`)
        .set('Authorization', adminAuth)
        .expect(200);
      const row = res.text
        .trim()
        .split('\n')
        .find((l) => l.startsWith(`${created.id},`));
      expect(row).toBeDefined();
      // the assigneeId column (last) is empty -> row ends with a comma
      expect((row as string).endsWith(',')).toBe(true);
    });

    it('imports valid rows and reports per-row failures', async () => {
      const csv = [
        'title,description,status,priority,type,assigneeId',
        'Imported one,desc,TODO,HIGH,BUG,',
        'Imported two,desc,IN_PROGRESS,LOW,FEATURE,',
        ',missing title,,,BUG,', // invalid: blank title
        'Bad type,,,,NONSENSE,', // invalid: bad type
      ].join('\n');

      const res = await request(ctx.server)
        .post('/tickets/import')
        .set('Authorization', adminAuth)
        .field('projectId', String(projectId))
        .attach('file', Buffer.from(csv), {
          filename: 'import.csv',
          contentType: 'text/csv',
        })
        .expect(200);

      expect(res.body).toMatchObject({ created: 2, failed: 2 });
      expect(res.body.errors).toHaveLength(2);
      expect(res.body.errors[0].row).toBe(3);
      expect(res.body.errors[1].row).toBe(4);

      // the two valid rows are now real tickets in the project
      const list = await request(ctx.server)
        .get(`/tickets?projectId=${projectId}`)
        .set('Authorization', adminAuth)
        .expect(200);
      expect(list.body).toHaveLength(2);
    });

    it('round-trips: imported tickets appear in a subsequent export', async () => {
      const csv = [
        'title,description,status,priority,type,assigneeId',
        'RoundTrip ticket,from csv,TODO,MEDIUM,BUG,',
      ].join('\n');
      await request(ctx.server)
        .post('/tickets/import')
        .set('Authorization', adminAuth)
        .field('projectId', String(projectId))
        .attach('file', Buffer.from(csv), {
          filename: 'import.csv',
          contentType: 'text/csv',
        })
        .expect(200);

      const res = await request(ctx.server)
        .get(`/tickets/export?projectId=${projectId}`)
        .set('Authorization', adminAuth)
        .expect(200);
      expect(res.text).toContain('RoundTrip ticket');
      expect(res.text).toContain('from csv');
    });

    it('400s on import with a missing projectId field', async () => {
      const csv = 'title,type\nSome ticket,BUG';
      await request(ctx.server)
        .post('/tickets/import')
        .set('Authorization', adminAuth)
        .attach('file', Buffer.from(csv), {
          filename: 'import.csv',
          contentType: 'text/csv',
        })
        .expect(400);
    });

    it('400s on import with no file uploaded', async () => {
      // The controller rejects a request that has the projectId field but
      // no `file` part — the multipart upload is mandatory.
      await request(ctx.server)
        .post('/tickets/import')
        .set('Authorization', adminAuth)
        .field('projectId', String(projectId))
        .expect(400);
    });

    it('404s on import for a non-existent project', async () => {
      const csv = 'title,type\nSome ticket,BUG';
      await request(ctx.server)
        .post('/tickets/import')
        .set('Authorization', adminAuth)
        .field('projectId', '999999')
        .attach('file', Buffer.from(csv), {
          filename: 'import.csv',
          contentType: 'text/csv',
        })
        .expect(404);
    });

    it('returns the exact { created, failed, errors } summary shape', async () => {
      // The README contract specifies this response body precisely.
      const csv = [
        'title,description,status,priority,type,assigneeId',
        'Summary check one,,TODO,HIGH,BUG,',
        ',blank title,,,BUG,', // invalid
      ].join('\n');

      const res = await request(ctx.server)
        .post('/tickets/import')
        .set('Authorization', adminAuth)
        .field('projectId', String(projectId))
        .attach('file', Buffer.from(csv), {
          filename: 'import.csv',
          contentType: 'text/csv',
        })
        .expect(200);

      // exactly three keys, no more
      expect(Object.keys(res.body).sort()).toEqual([
        'created',
        'errors',
        'failed',
      ]);
      expect(res.body.created).toBe(1);
      expect(res.body.failed).toBe(1);
      expect(Array.isArray(res.body.errors)).toBe(true);
      expect(res.body.errors[0]).toMatchObject({
        row: expect.any(Number),
        message: expect.any(String),
      });
    });

    it('400s on export with a missing projectId', async () => {
      await request(ctx.server)
        .get('/tickets/export')
        .set('Authorization', adminAuth)
        .expect(400);
    });
  });
});