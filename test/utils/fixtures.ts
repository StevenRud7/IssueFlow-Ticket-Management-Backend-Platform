import request from 'supertest';
import { App } from 'supertest/types';

/**
 * Reusable fixture helpers for the e2e suites. These wrap the most common
 * setup operations (register a user, log in, create a project/ticket) so
 * individual test files stay focused on the behaviour they verify rather
 * than repeating boilerplate.
 *
 * Every helper goes through the real HTTP layer with supertest — these are
 * genuine end-to-end calls, not shortcuts into the service layer.
 */

const DEFAULT_PASSWORD = 'password123';

export interface CreatedUser {
  id: number;
  username: string;
  role: 'ADMIN' | 'DEVELOPER';
}

/**
 * Register a user via POST /users (a public endpoint). Username is made
 * unique-ish by the caller; role defaults to DEVELOPER.
 */
export async function registerUser(
  server: App,
  username: string,
  role: 'ADMIN' | 'DEVELOPER' = 'DEVELOPER',
): Promise<CreatedUser> {
  const res = await request(server)
    .post('/users')
    .send({
      username,
      email: `${username}@example.com`,
      fullName: `User ${username}`,
      role,
      password: DEFAULT_PASSWORD,
    })
    .expect(200);
  return { id: res.body.id, username, role };
}

/**
 * Log in via POST /auth/login and return the bearer token string.
 */
export async function login(server: App, username: string): Promise<string> {
  const res = await request(server)
    .post('/auth/login')
    .send({ username, password: DEFAULT_PASSWORD })
    .expect(200);
  return res.body.accessToken as string;
}

/**
 * Register a user AND log in, returning both the user record and a ready
 * Authorization header value. The single most common test setup step.
 */
export async function registerAndLogin(
  server: App,
  username: string,
  role: 'ADMIN' | 'DEVELOPER' = 'DEVELOPER',
): Promise<{ user: CreatedUser; token: string; auth: string }> {
  const user = await registerUser(server, username, role);
  const token = await login(server, username);
  return { user, token, auth: `Bearer ${token}` };
}

/**
 * Create a project. Requires an auth header (all project endpoints are
 * protected). ownerId defaults to the authenticated user's id if supplied.
 */
export async function createProject(
  server: App,
  auth: string,
  name: string,
  ownerId: number,
): Promise<number> {
  const res = await request(server)
    .post('/projects')
    .set('Authorization', auth)
    .send({ name, description: `${name} description`, ownerId })
    .expect(200);
  return res.body.id as number;
}

/**
 * Create a ticket. `extra` lets a caller override or add fields
 * (priority, assigneeId, dueDate, status, etc.).
 *
 * Returns the supertest `Test` object (NOT an awaited Response) so callers
 * can chain `.expect(200)` and then read `.body`. supertest's `Test` is a
 * thenable, so `await createTicket(...)` still works directly too.
 */
export function createTicket(
  server: App,
  auth: string,
  projectId: number,
  title: string,
  extra: Record<string, unknown> = {},
): request.Test {
  return request(server)
    .post('/tickets')
    .set('Authorization', auth)
    .send({ title, type: 'BUG', projectId, ...extra });
}

export { DEFAULT_PASSWORD };