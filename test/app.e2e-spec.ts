import request from 'supertest';
import { bootstrapTestApp, resetDatabase, TestContext } from './utils/e2e-app';
import { registerAndLogin, registerUser } from './utils/fixtures';

/**
 * E2E — Foundation, Health, and User Management (§2.1).
 *
 * Verifies the app boots, the health endpoints answer, and the full Users
 * CRUD contract works through the real HTTP stack with a real database.
 */
describe('Foundation + Users (e2e)', () => {
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

  describe('health endpoints', () => {
    it('GET / returns a greeting (public)', async () => {
      await request(ctx.server).get('/').expect(200);
    });

    it('GET /health reports status ok (public)', async () => {
      const res = await request(ctx.server).get('/health').expect(200);
      expect(res.body.status).toBe('ok');
    });
  });

  describe('POST /users — registration', () => {
    it('creates a user and never returns the password hash', async () => {
      const res = await request(ctx.server)
        .post('/users')
        .send({
          username: 'jdoe',
          email: 'jdoe@example.com',
          fullName: 'John Doe',
          role: 'DEVELOPER',
          password: 'password123',
        })
        .expect(200);

      expect(res.body).toMatchObject({
        id: expect.any(Number),
        username: 'jdoe',
        email: 'jdoe@example.com',
        fullName: 'John Doe',
        role: 'DEVELOPER',
      });
      expect(res.body).not.toHaveProperty('password');
      expect(res.body).not.toHaveProperty('passwordHash');
      expect(res.body).not.toHaveProperty('password_hash');
    });

    it('creates a user with the exact README body (no password) -> 200', async () => {
      // The README "Create a user" contract body is { username, email,
      // fullName, role } with NO password, and expects 200 OK.
      const res = await request(ctx.server)
        .post('/users')
        .send({
          username: 'jdoe',
          email: 'jdoe@example.com',
          fullName: 'John Doe',
          role: 'DEVELOPER',
        })
        .expect(200);

      expect(res.body).toMatchObject({
        id: expect.any(Number),
        username: 'jdoe',
        email: 'jdoe@example.com',
        fullName: 'John Doe',
        role: 'DEVELOPER',
      });
      expect(res.body).not.toHaveProperty('password');
      expect(res.body).not.toHaveProperty('password_hash');
    });

    it('a user created without a password cannot log in -> 401', async () => {
      await request(ctx.server)
        .post('/users')
        .send({
          username: 'nopass',
          email: 'nopass@example.com',
          fullName: 'No Password',
          role: 'DEVELOPER',
        })
        .expect(200);

      // No password was ever set, so login must be rejected.
      await request(ctx.server)
        .post('/auth/login')
        .send({ username: 'nopass', password: 'anything-at-all' })
        .expect(401);
    });

    it('rejects a duplicate username with 409', async () => {
      await registerUser(ctx.server, 'dupe');
      await request(ctx.server)
        .post('/users')
        .send({
          username: 'dupe',
          email: 'other@example.com',
          fullName: 'Other',
          role: 'DEVELOPER',
          password: 'password123',
        })
        .expect(409);
    });

    it('rejects an invalid role with 400', async () => {
      await request(ctx.server)
        .post('/users')
        .send({
          username: 'badrole',
          email: 'br@example.com',
          fullName: 'Bad Role',
          role: 'SUPERUSER',
          password: 'password123',
        })
        .expect(400);
    });

    it('rejects an unknown extra property with 400 (whitelist)', async () => {
      await request(ctx.server)
        .post('/users')
        .send({
          username: 'extra',
          email: 'ex@example.com',
          fullName: 'Extra',
          role: 'DEVELOPER',
          password: 'password123',
          isSuperAdmin: true,
        })
        .expect(400);
    });

    it('rejects a missing required field with 400', async () => {
      await request(ctx.server)
        .post('/users')
        .send({ username: 'noemail', fullName: 'No Email', role: 'DEVELOPER' })
        .expect(400);
    });
  });

  describe('Users CRUD (authenticated)', () => {
    it('GET /users lists users', async () => {
      const { auth } = await registerAndLogin(ctx.server, 'lister', 'ADMIN');
      await registerUser(ctx.server, 'second');

      const res = await request(ctx.server)
        .get('/users')
        .set('Authorization', auth)
        .expect(200);
      expect(res.body).toHaveLength(2);
    });

    it('GET /users/:id returns one user; 404 for a missing id', async () => {
      const { user, auth } = await registerAndLogin(ctx.server, 'finder');

      const ok = await request(ctx.server)
        .get(`/users/${user.id}`)
        .set('Authorization', auth)
        .expect(200);
      expect(ok.body.username).toBe('finder');

      await request(ctx.server)
        .get('/users/99999')
        .set('Authorization', auth)
        .expect(404);
    });

    it('POST /users/update/:id updates fullName and role', async () => {
      const { user, auth } = await registerAndLogin(
        ctx.server,
        'updater',
        'ADMIN',
      );
      const res = await request(ctx.server)
        .post(`/users/update/${user.id}`)
        .set('Authorization', auth)
        .send({ fullName: 'Renamed Person', role: 'ADMIN' })
        .expect(200);
      expect(res.body.fullName).toBe('Renamed Person');
      expect(res.body.role).toBe('ADMIN');
    });

    it('DELETE /users/:id removes the user', async () => {
      const { auth } = await registerAndLogin(ctx.server, 'keeper', 'ADMIN');
      const victim = await registerUser(ctx.server, 'victim');

      await request(ctx.server)
        .delete(`/users/${victim.id}`)
        .set('Authorization', auth)
        .expect(200);
      await request(ctx.server)
        .get(`/users/${victim.id}`)
        .set('Authorization', auth)
        .expect(404);
    });
  });

  describe('global JWT protection (§2.2)', () => {
    it('rejects an unauthenticated request to a protected route with 401', async () => {
      await request(ctx.server).get('/users').expect(401);
    });

    it('rejects a malformed bearer token with 401', async () => {
      await request(ctx.server)
        .get('/users')
        .set('Authorization', 'Bearer not-a-real-token')
        .expect(401);
    });
  });
});