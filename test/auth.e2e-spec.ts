import request from 'supertest';
import { bootstrapTestApp, resetDatabase, TestContext } from './utils/e2e-app';
import { registerUser } from './utils/fixtures';

/**
 * E2E — Authentication (§2.2).
 *
 * Covers login (valid + invalid credentials), the /auth/me identity
 * endpoint, and logout — including the key behaviour that a logged-out
 * token is added to the deny-list and stops working.
 */
describe('Auth (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await bootstrapTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  beforeEach(async () => {
    await resetDatabase(ctx.db);
  });

  describe('POST /auth/login', () => {
    it('returns a JWT for valid credentials', async () => {
      await registerUser(ctx.server, 'authuser');
      const res = await request(ctx.server)
        .post('/auth/login')
        .send({ username: 'authuser', password: 'password123' })
        .expect(200);

      expect(res.body).toMatchObject({
        accessToken: expect.any(String),
        tokenType: 'Bearer',
        expiresIn: expect.any(Number),
      });
    });

    it('rejects a wrong password with 401', async () => {
      await registerUser(ctx.server, 'authuser2');
      await request(ctx.server)
        .post('/auth/login')
        .send({ username: 'authuser2', password: 'wrongpassword' })
        .expect(401);
    });

    it('rejects an unknown username with 401', async () => {
      await request(ctx.server)
        .post('/auth/login')
        .send({ username: 'ghost', password: 'password123' })
        .expect(401);
    });
  });

  describe('GET /auth/me', () => {
    it('returns the authenticated user', async () => {
      const user = await registerUser(ctx.server, 'meuser');
      const login = await request(ctx.server)
        .post('/auth/login')
        .send({ username: 'meuser', password: 'password123' })
        .expect(200);

      const res = await request(ctx.server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${login.body.accessToken}`)
        .expect(200);
      expect(res.body.id).toBe(user.id);
      expect(res.body.username).toBe('meuser');
    });

    it('rejects an unauthenticated request with 401', async () => {
      await request(ctx.server).get('/auth/me').expect(401);
    });
  });

  describe('POST /auth/logout — token deny-list', () => {
    it('invalidates the token so subsequent requests are 401', async () => {
      await registerUser(ctx.server, 'logoutuser');
      const login = await request(ctx.server)
        .post('/auth/login')
        .send({ username: 'logoutuser', password: 'password123' })
        .expect(200);
      const token = login.body.accessToken;

      // token works before logout
      await request(ctx.server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // logout
      await request(ctx.server)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      // same token is now rejected
      await request(ctx.server)
        .get('/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });
  });
});