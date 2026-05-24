import request from 'supertest';
import { bootstrapTestApp, resetDatabase, TestContext } from './utils/e2e-app';
import {
  createProject,
  createTicket,
  registerAndLogin,
  registerUser,
} from './utils/fixtures';

/**
 * E2E — Dependencies (§3.2), Auto-Assignment (§3.8), Auto-Escalation
 * (§3.7), and the Audit Log (§3.1).
 *
 * These are the "smart" behaviours of the system; each is verified
 * through the real HTTP API against a real database.
 */
describe('Dependencies + Auto-Assignment + Escalation + Audit (e2e)', () => {
  let ctx: TestContext;
  let auth: string;
  let adminId: number;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.db);
    const admin = await registerAndLogin(ctx.server, 'admin', 'ADMIN');
    auth = admin.auth;
    adminId = admin.user.id;
  });

  // ---- Dependencies (§3.2) -----------------------------------------------

  describe('ticket dependencies', () => {
    it('adds a blocker and lists it', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', adminId);
      const a = (
        await createTicket(ctx.server, auth, projectId, 'A').expect(200)
      ).body;
      const b = (
        await createTicket(ctx.server, auth, projectId, 'B').expect(200)
      ).body;

      await request(ctx.server)
        .post(`/tickets/${a.id}/dependencies`)
        .set('Authorization', auth)
        .send({ blockedBy: b.id })
        .expect(200);

      const list = await request(ctx.server)
        .get(`/tickets/${a.id}/dependencies`)
        .set('Authorization', auth)
        .expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0]).toMatchObject({ id: b.id, title: 'B' });
    });

    it('rejects a self-dependency with 400', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', adminId);
      const a = (
        await createTicket(ctx.server, auth, projectId, 'A').expect(200)
      ).body;
      await request(ctx.server)
        .post(`/tickets/${a.id}/dependencies`)
        .set('Authorization', auth)
        .send({ blockedBy: a.id })
        .expect(400);
    });

    it('rejects a cross-project dependency with 400', async () => {
      const p1 = await createProject(ctx.server, auth, 'P1', adminId);
      const p2 = await createProject(ctx.server, auth, 'P2', adminId);
      const a = (await createTicket(ctx.server, auth, p1, 'A').expect(200))
        .body;
      const b = (await createTicket(ctx.server, auth, p2, 'B').expect(200))
        .body;
      await request(ctx.server)
        .post(`/tickets/${a.id}/dependencies`)
        .set('Authorization', auth)
        .send({ blockedBy: b.id })
        .expect(400);
    });

    it('rejects a dependency that would create a cycle with 400', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', adminId);
      const a = (
        await createTicket(ctx.server, auth, projectId, 'A').expect(200)
      ).body;
      const b = (
        await createTicket(ctx.server, auth, projectId, 'B').expect(200)
      ).body;

      // A blocked by B
      await request(ctx.server)
        .post(`/tickets/${a.id}/dependencies`)
        .set('Authorization', auth)
        .send({ blockedBy: b.id })
        .expect(200);
      // B blocked by A would close a loop → 400
      await request(ctx.server)
        .post(`/tickets/${b.id}/dependencies`)
        .set('Authorization', auth)
        .send({ blockedBy: a.id })
        .expect(400);
    });

    it('blocks DONE while a blocker is unresolved, then allows it once resolved', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', adminId);
      const a = (
        await createTicket(ctx.server, auth, projectId, 'A').expect(200)
      ).body;
      const b = (
        await createTicket(ctx.server, auth, projectId, 'B').expect(200)
      ).body;

      await request(ctx.server)
        .post(`/tickets/${a.id}/dependencies`)
        .set('Authorization', auth)
        .send({ blockedBy: b.id })
        .expect(200);

      // A → DONE blocked because B is not DONE
      await request(ctx.server)
        .patch(`/tickets/${a.id}`)
        .set('Authorization', auth)
        .send({ status: 'DONE', version: a.version })
        .expect(409);

      // resolve B
      await request(ctx.server)
        .patch(`/tickets/${b.id}`)
        .set('Authorization', auth)
        .send({ status: 'DONE', version: b.version })
        .expect(200);

      // now A → DONE succeeds
      await request(ctx.server)
        .patch(`/tickets/${a.id}`)
        .set('Authorization', auth)
        .send({ status: 'DONE', version: a.version })
        .expect(200);
    });

    it('removes a dependency', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', adminId);
      const a = (
        await createTicket(ctx.server, auth, projectId, 'A').expect(200)
      ).body;
      const b = (
        await createTicket(ctx.server, auth, projectId, 'B').expect(200)
      ).body;
      await request(ctx.server)
        .post(`/tickets/${a.id}/dependencies`)
        .set('Authorization', auth)
        .send({ blockedBy: b.id })
        .expect(200);
      await request(ctx.server)
        .delete(`/tickets/${a.id}/dependencies/${b.id}`)
        .set('Authorization', auth)
        .expect(200);
      const list = await request(ctx.server)
        .get(`/tickets/${a.id}/dependencies`)
        .set('Authorization', auth)
        .expect(200);
      expect(list.body).toHaveLength(0);
    });
  });

  // ---- Auto-Assignment (§3.8) --------------------------------------------

  describe('auto-assignment', () => {
    it('assigns the least-loaded developer, breaking ties by registration order', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', adminId);
      const dev1 = await registerUser(ctx.server, 'dev1'); // registered first
      const dev2 = await registerUser(ctx.server, 'dev2');

      // first ticket → dev1 (tie at 0, oldest wins)
      const t1 = (
        await createTicket(ctx.server, auth, projectId, 'T1').expect(200)
      ).body;
      expect(t1.assigneeId).toBe(dev1.id);

      // second ticket → dev2 (dev1 now has 1, dev2 has 0)
      const t2 = (
        await createTicket(ctx.server, auth, projectId, 'T2').expect(200)
      ).body;
      expect(t2.assigneeId).toBe(dev2.id);

      // third ticket → dev1 again (both at 1, oldest wins)
      const t3 = (
        await createTicket(ctx.server, auth, projectId, 'T3').expect(200)
      ).body;
      expect(t3.assigneeId).toBe(dev1.id);
    });

    it('does not auto-assign when assigneeId is explicitly provided', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', adminId);
      await registerUser(ctx.server, 'devX');
      const explicit = await registerUser(ctx.server, 'devChosen');

      const t = (
        await createTicket(ctx.server, auth, projectId, 'T', {
          assigneeId: explicit.id,
        }).expect(200)
      ).body;
      expect(t.assigneeId).toBe(explicit.id);
    });

    it('creates an unassigned ticket when there are no developers', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', adminId);
      // only the ADMIN exists — ADMINs are not auto-assignment candidates
      const t = (
        await createTicket(ctx.server, auth, projectId, 'T').expect(200)
      ).body;
      expect(t.assigneeId).toBeNull();
    });

    it('GET /projects/:id/workload reports per-developer open counts', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', adminId);
      const dev1 = await registerUser(ctx.server, 'wdev1');
      await registerUser(ctx.server, 'wdev2');
      await createTicket(ctx.server, auth, projectId, 'T1', {
        assigneeId: dev1.id,
      }).expect(200);

      const res = await request(ctx.server)
        .get(`/projects/${projectId}/workload`)
        .set('Authorization', auth)
        .expect(200);
      // sorted ascending by openTicketCount
      expect(res.body[0].openTicketCount).toBeLessThanOrEqual(
        res.body[1].openTicketCount,
      );
      const dev1Row = res.body.find(
        (r: { userId: number }) => r.userId === dev1.id,
      );
      expect(dev1Row.openTicketCount).toBe(1);
    });
  });

  // ---- Auto-Escalation (§3.7) --------------------------------------------

  describe('auto-escalation', () => {
    it('promotes overdue tickets one priority level when escalation runs', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', adminId);
      const t = (
        await createTicket(ctx.server, auth, projectId, 'overdue', {
          priority: 'LOW',
          dueDate: '2999-01-01T00:00:00Z',
        }).expect(200)
      ).body;

      // backdate the dueDate directly so the ticket is overdue NOW
      await ctx.db.query(
        `UPDATE tickets SET due_date = NOW() - INTERVAL '1 day' WHERE id = $1`,
        [t.id],
      );

      // trigger an escalation cycle via the admin endpoint
      const summary = await request(ctx.server)
        .post('/admin/escalation/run')
        .set('Authorization', auth)
        .expect(200);
      expect(summary.body.promoted).toBeGreaterThanOrEqual(1);

      const after = await request(ctx.server)
        .get(`/tickets/${t.id}`)
        .set('Authorization', auth)
        .expect(200);
      expect(after.body.priority).toBe('MEDIUM'); // LOW → MEDIUM
    });

    it('is idempotent — a CRITICAL overdue ticket gets isOverdue, not a further promotion', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', adminId);
      const t = (
        await createTicket(ctx.server, auth, projectId, 'critical', {
          priority: 'CRITICAL',
          dueDate: '2999-01-01T00:00:00Z',
        }).expect(200)
      ).body;
      await ctx.db.query(
        `UPDATE tickets SET due_date = NOW() - INTERVAL '1 day' WHERE id = $1`,
        [t.id],
      );

      // first run flags it overdue
      await request(ctx.server)
        .post('/admin/escalation/run')
        .set('Authorization', auth)
        .expect(200);
      const after1 = await request(ctx.server)
        .get(`/tickets/${t.id}`)
        .set('Authorization', auth)
        .expect(200);
      expect(after1.body.priority).toBe('CRITICAL');
      expect(after1.body.isOverdue).toBe(true);

      // second run does nothing further (idempotent)
      const summary2 = await request(ctx.server)
        .post('/admin/escalation/run')
        .set('Authorization', auth)
        .expect(200);
      expect(summary2.body.promoted).toBe(0);
      expect(summary2.body.markedOverdue).toBe(0);
    });

    it('rejects the manual escalation trigger for a non-ADMIN with 403', async () => {
      const dev = await registerAndLogin(ctx.server, 'plaindev', 'DEVELOPER');
      await request(ctx.server)
        .post('/admin/escalation/run')
        .set('Authorization', dev.auth)
        .expect(403);
    });
  });

  // ---- Audit Log (§3.1) ---------------------------------------------------

  describe('audit log', () => {
    it('records CREATE entries for state-changing actions', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', adminId);
      await createTicket(ctx.server, auth, projectId, 'audited').expect(200);

      const res = await request(ctx.server)
        .get('/audit-logs?entityType=TICKET&action=CREATE')
        .set('Authorization', auth)
        .expect(200);
      // README contract: response is a bare array, newest first.
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body.length).toBeGreaterThanOrEqual(1);
      expect(res.body[0]).toMatchObject({
        action: 'CREATE',
        entityType: 'TICKET',
      });
    });

    it('records an UPDATE entry with a field diff', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', adminId);
      const t = (
        await createTicket(ctx.server, auth, projectId, 'before').expect(200)
      ).body;
      await request(ctx.server)
        .patch(`/tickets/${t.id}`)
        .set('Authorization', auth)
        .send({ title: 'after', version: t.version })
        .expect(200);

      const res = await request(ctx.server)
        .get(`/audit-logs?entityType=TICKET&entityId=${t.id}&action=UPDATE`)
        .set('Authorization', auth)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].metadata).toMatchObject({
        title: { from: 'before', to: 'after' },
      });
    });

    it('records a SYSTEM-actor entry for auto-assignment', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', adminId);
      await registerUser(ctx.server, 'autodev');
      await createTicket(ctx.server, auth, projectId, 'auto').expect(200);

      const res = await request(ctx.server)
        .get('/audit-logs?action=AUTO_ASSIGN')
        .set('Authorization', auth)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        actor: 'SYSTEM',
        action: 'AUTO_ASSIGN',
        performedBy: null,
      });
    });

    it('rejects an invalid filter enum with 400', async () => {
      await request(ctx.server)
        .get('/audit-logs?action=BOGUS')
        .set('Authorization', auth)
        .expect(400);
    });
  });
});