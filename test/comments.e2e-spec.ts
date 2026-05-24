import request from 'supertest';
import { bootstrapTestApp, resetDatabase, TestContext } from './utils/e2e-app';
import {
  createProject,
  createTicket,
  registerAndLogin,
  registerUser,
} from './utils/fixtures';

/**
 * E2E — Comments (§2.5) and @Mentions (§3.6).
 *
 * Verifies comment CRUD scoped under a ticket, the cross-ticket guard,
 * comment optimistic locking, @mention parsing/resolution, and the
 * per-user mentions feed.
 */
describe('Comments + Mentions (e2e)', () => {
  let ctx: TestContext;
  let auth: string;
  let userId: number;
  let projectId: number;
  let ticketId: number;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.db);
    const admin = await registerAndLogin(ctx.server, 'author', 'ADMIN');
    auth = admin.auth;
    userId = admin.user.id;
    projectId = await createProject(ctx.server, auth, 'P', userId);
    ticketId = (
      await createTicket(ctx.server, auth, projectId, 'T').expect(200)
    ).body.id;
  });

  describe('comment CRUD', () => {
    it('creates and lists comments on a ticket', async () => {
      await request(ctx.server)
        .post(`/tickets/${ticketId}/comments`)
        .set('Authorization', auth)
        .send({ authorId: userId, content: 'First comment' })
        .expect(200);

      const list = await request(ctx.server)
        .get(`/tickets/${ticketId}/comments`)
        .set('Authorization', auth)
        .expect(200);
      expect(list.body).toHaveLength(1);
      expect(list.body[0].content).toBe('First comment');
    });

    it('updates a comment with the correct version', async () => {
      const created = await request(ctx.server)
        .post(`/tickets/${ticketId}/comments`)
        .set('Authorization', auth)
        .send({ authorId: userId, content: 'original' })
        .expect(200);

      const updated = await request(ctx.server)
        .patch(`/tickets/${ticketId}/comments/${created.body.id}`)
        .set('Authorization', auth)
        .send({ content: 'edited', version: created.body.version })
        .expect(200);
      expect(updated.body.content).toBe('edited');
    });

    it('rejects a stale comment version with 409', async () => {
      const created = await request(ctx.server)
        .post(`/tickets/${ticketId}/comments`)
        .set('Authorization', auth)
        .send({ authorId: userId, content: 'original' })
        .expect(200);

      await request(ctx.server)
        .patch(`/tickets/${ticketId}/comments/${created.body.id}`)
        .set('Authorization', auth)
        .send({ content: 'first edit', version: created.body.version })
        .expect(200);

      await request(ctx.server)
        .patch(`/tickets/${ticketId}/comments/${created.body.id}`)
        .set('Authorization', auth)
        .send({ content: 'second edit', version: created.body.version })
        .expect(409);
    });

    it('deletes a comment', async () => {
      const created = await request(ctx.server)
        .post(`/tickets/${ticketId}/comments`)
        .set('Authorization', auth)
        .send({ authorId: userId, content: 'to delete' })
        .expect(200);

      await request(ctx.server)
        .delete(`/tickets/${ticketId}/comments/${created.body.id}`)
        .set('Authorization', auth)
        .expect(200);

      const list = await request(ctx.server)
        .get(`/tickets/${ticketId}/comments`)
        .set('Authorization', auth)
        .expect(200);
      expect(list.body).toHaveLength(0);
    });

    it('404s when the comment belongs to a different ticket', async () => {
      const otherTicket = (
        await createTicket(ctx.server, auth, projectId, 'other').expect(200)
      ).body.id;
      const created = await request(ctx.server)
        .post(`/tickets/${ticketId}/comments`)
        .set('Authorization', auth)
        .send({ authorId: userId, content: 'belongs to ticketId' })
        .expect(200);

      // try to edit it via the wrong ticket path
      await request(ctx.server)
        .patch(`/tickets/${otherTicket}/comments/${created.body.id}`)
        .set('Authorization', auth)
        .send({ content: 'hijack', version: created.body.version })
        .expect(404);
    });
  });

  describe('@mentions (§3.6)', () => {
    it('resolves @username mentions and exposes them on the comment', async () => {
      const mentioned = await registerUser(ctx.server, 'mentionee');

      const created = await request(ctx.server)
        .post(`/tickets/${ticketId}/comments`)
        .set('Authorization', auth)
        .send({
          authorId: userId,
          content: 'hey @mentionee please look',
        })
        .expect(200);

      expect(created.body.mentionedUsers).toHaveLength(1);
      expect(created.body.mentionedUsers[0]).toMatchObject({
        id: mentioned.id,
        username: 'mentionee',
      });
    });

    it('matches mentions case-insensitively', async () => {
      await registerUser(ctx.server, 'lowercase');
      const created = await request(ctx.server)
        .post(`/tickets/${ticketId}/comments`)
        .set('Authorization', auth)
        .send({ authorId: userId, content: 'ping @LOWERCASE' })
        .expect(200);
      expect(created.body.mentionedUsers).toHaveLength(1);
    });

    it('silently ignores an unknown @username', async () => {
      const created = await request(ctx.server)
        .post(`/tickets/${ticketId}/comments`)
        .set('Authorization', auth)
        .send({ authorId: userId, content: 'hi @doesnotexist' })
        .expect(200);
      expect(created.body.mentionedUsers).toHaveLength(0);
    });

    it('GET /users/:id/mentions returns the paginated mention feed', async () => {
      const mentioned = await registerUser(ctx.server, 'feeduser');
      await request(ctx.server)
        .post(`/tickets/${ticketId}/comments`)
        .set('Authorization', auth)
        .send({ authorId: userId, content: 'first @feeduser' })
        .expect(200);
      await request(ctx.server)
        .post(`/tickets/${ticketId}/comments`)
        .set('Authorization', auth)
        .send({ authorId: userId, content: 'second @feeduser' })
        .expect(200);

      const res = await request(ctx.server)
        .get(`/users/${mentioned.id}/mentions`)
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toMatchObject({
        total: 2,
        page: 1,
        data: expect.any(Array),
      });
      expect(res.body.data).toHaveLength(2);
    });
  });
});