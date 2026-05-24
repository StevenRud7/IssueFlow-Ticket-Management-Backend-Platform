import request from 'supertest';
import { bootstrapTestApp, resetDatabase, TestContext } from './utils/e2e-app';
import {
  createProject,
  createTicket,
  registerAndLogin,
} from './utils/fixtures';

/**
 * E2E — Projects (§2.3) and Tickets (§2.4).
 *
 * Verifies project CRUD, ticket CRUD, and the two non-trivial ticket
 * rules: the forward-only status lifecycle (DONE is terminal) and
 * optimistic-locking via the `version` field.
 */
describe('Projects + Tickets (e2e)', () => {
  let ctx: TestContext;
  let auth: string;
  let userId: number;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.db);
    const admin = await registerAndLogin(ctx.server, 'owner', 'ADMIN');
    auth = admin.auth;
    userId = admin.user.id;
  });

  // ---- Projects -----------------------------------------------------------

  describe('Projects CRUD', () => {
    it('creates, reads, updates and lists projects', async () => {
      const id = await createProject(ctx.server, auth, 'Alpha', userId);

      const got = await request(ctx.server)
        .get(`/projects/${id}`)
        .set('Authorization', auth)
        .expect(200);
      expect(got.body).toMatchObject({ id, name: 'Alpha', ownerId: userId });

      await request(ctx.server)
        .patch(`/projects/${id}`)
        .set('Authorization', auth)
        .send({ name: 'Alpha Renamed' })
        .expect(200);

      const list = await request(ctx.server)
        .get('/projects')
        .set('Authorization', auth)
        .expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].name).toBe('Alpha Renamed');
    });

    it('rejects a project with a non-existent owner (404)', async () => {
      await request(ctx.server)
        .post('/projects')
        .set('Authorization', auth)
        .send({ name: 'Orphan', description: 'x', ownerId: 99999 })
        .expect(404);
    });

    it('404s on GET of a missing project', async () => {
      await request(ctx.server)
        .get('/projects/99999')
        .set('Authorization', auth)
        .expect(404);
    });
  });

  // ---- Tickets ------------------------------------------------------------

  describe('Tickets CRUD', () => {
    it('creates a ticket with defaults and reads it back', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', userId);
      const created = await createTicket(
        ctx.server,
        auth,
        projectId,
        'My ticket',
      ).expect(200);

      expect(created.body).toMatchObject({
        id: expect.any(Number),
        title: 'My ticket',
        type: 'BUG',
        status: 'TODO', // default
        priority: 'MEDIUM', // default
        projectId,
        isOverdue: false,
        version: expect.any(Number),
      });
    });

    it('rejects a ticket for a non-existent project (404)', async () => {
      await request(ctx.server)
        .post('/tickets')
        .set('Authorization', auth)
        .send({ title: 'X', type: 'BUG', projectId: 99999 })
        .expect(404);
    });

    it('rejects an invalid ticket type with 400', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', userId);
      await request(ctx.server)
        .post('/tickets')
        .set('Authorization', auth)
        .send({ title: 'X', type: 'NONSENSE', projectId })
        .expect(400);
    });

    it('filters tickets by projectId', async () => {
      const p1 = await createProject(ctx.server, auth, 'P1', userId);
      const p2 = await createProject(ctx.server, auth, 'P2', userId);
      await createTicket(ctx.server, auth, p1, 'in p1').expect(200);
      await createTicket(ctx.server, auth, p2, 'in p2').expect(200);

      const res = await request(ctx.server)
        .get(`/tickets?projectId=${p1}`)
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toHaveLength(1);
      expect(res.body[0].title).toBe('in p1');
    });
  });

  // ---- Ticket lifecycle (§2.4) -------------------------------------------

  describe('ticket status lifecycle', () => {
    it('allows forward transitions TODO → IN_PROGRESS → IN_REVIEW → DONE', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', userId);
      const t = (
        await createTicket(ctx.server, auth, projectId, 'lifecycle').expect(200)
      ).body;

      let version = t.version;
      for (const status of ['IN_PROGRESS', 'IN_REVIEW', 'DONE']) {
        const res = await request(ctx.server)
          .patch(`/tickets/${t.id}`)
          .set('Authorization', auth)
          .send({ status, version })
          .expect(200);
        expect(res.body.status).toBe(status);
        version = res.body.version;
      }
    });

    it('rejects a backwards transition with 400', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', userId);
      const t = (
        await createTicket(ctx.server, auth, projectId, 'backwards').expect(200)
      ).body;

      const moved = await request(ctx.server)
        .patch(`/tickets/${t.id}`)
        .set('Authorization', auth)
        .send({ status: 'IN_REVIEW', version: t.version })
        .expect(200);

      await request(ctx.server)
        .patch(`/tickets/${t.id}`)
        .set('Authorization', auth)
        .send({ status: 'TODO', version: moved.body.version })
        .expect(400);
    });

    it('treats DONE as terminal — any update is 409', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', userId);
      const t = (
        await createTicket(ctx.server, auth, projectId, 'terminal').expect(200)
      ).body;

      const done = await request(ctx.server)
        .patch(`/tickets/${t.id}`)
        .set('Authorization', auth)
        .send({ status: 'DONE', version: t.version })
        .expect(200);

      await request(ctx.server)
        .patch(`/tickets/${t.id}`)
        .set('Authorization', auth)
        .send({ title: 'cannot change', version: done.body.version })
        .expect(409);
    });
  });

  // ---- Optimistic locking -------------------------------------------------

  describe('optimistic locking', () => {
    it('bumps version on each update', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', userId);
      const t = (
        await createTicket(ctx.server, auth, projectId, 'versioned').expect(200)
      ).body;

      const updated = await request(ctx.server)
        .patch(`/tickets/${t.id}`)
        .set('Authorization', auth)
        .send({ title: 'new title', version: t.version })
        .expect(200);
      expect(updated.body.version).toBe(t.version + 1);
    });

    it('rejects a stale version with 409', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', userId);
      const t = (
        await createTicket(ctx.server, auth, projectId, 'stale').expect(200)
      ).body;

      // first update succeeds (consumes the version)
      await request(ctx.server)
        .patch(`/tickets/${t.id}`)
        .set('Authorization', auth)
        .send({ title: 'first', version: t.version })
        .expect(200);

      // second update reuses the now-stale version → 409
      await request(ctx.server)
        .patch(`/tickets/${t.id}`)
        .set('Authorization', auth)
        .send({ title: 'second', version: t.version })
        .expect(409);
    });

    it('rejects an update with no version field (400)', async () => {
      const projectId = await createProject(ctx.server, auth, 'P', userId);
      const t = (
        await createTicket(ctx.server, auth, projectId, 'noversion').expect(200)
      ).body;

      await request(ctx.server)
        .patch(`/tickets/${t.id}`)
        .set('Authorization', auth)
        .send({ title: 'missing version' })
        .expect(400);
    });
  });
});