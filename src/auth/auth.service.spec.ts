import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import * as bcrypt from 'bcryptjs';
import { UserRole } from '../users/entities/user-role.enum';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';
import { TokenDenylistRepository } from './token-denylist.repository';

/**
 * Unit tests for AuthService — all dependencies mocked.
 *
 * Covers:
 *   - login: happy path returns README-shaped response, jti is a UUID
 *   - login: wrong password rejects
 *   - login: missing user rejects (with same 401, no info-leak)
 *   - logout: writes the jti to the deny-list with the right expiry
 *   - expiresIn parsing: bare seconds, "1h", "30m", "7d"
 */
describe('AuthService', () => {
  let service: AuthService;
  let users: jest.Mocked<UsersService>;
  let jwt: jest.Mocked<JwtService>;
  let denylist: jest.Mocked<TokenDenylistRepository>;
  let config: ConfigService;

  const passwordHash = bcrypt.hashSync('correct-horse', 4);

  beforeEach(async () => {
    const usersMock = {
      findRawByUsername: jest.fn(),
    } as unknown as jest.Mocked<UsersService>;
    const jwtMock = {
      signAsync: jest.fn().mockResolvedValue('signed.jwt.token'),
    } as unknown as jest.Mocked<JwtService>;
    const denylistMock = {
      revoke: jest.fn().mockResolvedValue(undefined),
      isRevoked: jest.fn(),
    } as unknown as jest.Mocked<TokenDenylistRepository>;
    const configMock = {
      get: jest.fn((key: string) => {
        if (key === 'JWT_EXPIRES_IN') return '3600';
        return undefined;
      }),
    } as unknown as ConfigService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: usersMock },
        { provide: JwtService, useValue: jwtMock },
        { provide: ConfigService, useValue: configMock },
        { provide: TokenDenylistRepository, useValue: denylistMock },
      ],
    }).compile();

    service = module.get(AuthService);
    users = module.get(UsersService);
    jwt = module.get(JwtService);
    denylist = module.get(TokenDenylistRepository);
    config = module.get(ConfigService);
  });

  describe('login', () => {
    it('signs and returns the README envelope on valid credentials', async () => {
      users.findRawByUsername.mockResolvedValue({
        id: 1,
        username: 'jdoe',
        email: 'jdoe@example.com',
        full_name: 'John Doe',
        role: UserRole.DEVELOPER,
        password_hash: passwordHash,
        created_at: new Date(),
        updated_at: new Date(),
      });

      const result = await service.login('jdoe', 'correct-horse');

      expect(result).toEqual({
        accessToken: 'signed.jwt.token',
        tokenType: 'Bearer',
        expiresIn: 3600,
      });

      // The JWT payload should contain sub, username, role, and a UUIDv4 jti
      const payload = jwt.signAsync.mock.calls[0][0] as {
        sub: number;
        username: string;
        role: UserRole;
        jti: string;
      };
      expect(payload.sub).toBe(1);
      expect(payload.username).toBe('jdoe');
      expect(payload.role).toBe(UserRole.DEVELOPER);
      expect(payload.jti).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('rejects wrong password with 401', async () => {
      users.findRawByUsername.mockResolvedValue({
        id: 1,
        username: 'jdoe',
        email: 'jdoe@example.com',
        full_name: 'John Doe',
        role: UserRole.DEVELOPER,
        password_hash: passwordHash,
        created_at: new Date(),
        updated_at: new Date(),
      });
      await expect(
        service.login('jdoe', 'wrong-password'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });

    it('rejects unknown username with 401 (no info-leak about whether user exists)', async () => {
      users.findRawByUsername.mockResolvedValue(null);
      await expect(service.login('nobody', 'whatever')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(jwt.signAsync).not.toHaveBeenCalled();
    });
  });

  describe('logout', () => {
    it('writes the jti to the deny-list with the token expiry as a Date', async () => {
      const exp = Math.floor(Date.now() / 1000) + 3600;
      await service.logout(1, 'jti-abc', exp);
      expect(denylist.revoke).toHaveBeenCalledWith(
        'jti-abc',
        1,
        new Date(exp * 1000),
      );
    });
  });

  describe('expiresIn parsing', () => {
    const cases: Array<[string, number]> = [
      ['3600', 3600],
      ['60s', 60],
      ['30m', 30 * 60],
      ['1h', 3600],
      ['7d', 7 * 86_400],
      ['nonsense', 3600], // safe default
    ];
    it.each(cases)('parses %p → %p seconds', async (input, expected) => {
      (config.get as jest.Mock).mockReturnValueOnce(input);
      // Need a fresh instance so the constructor picks up the new value
      const fresh = new AuthService(users, jwt, config, denylist);
      users.findRawByUsername.mockResolvedValue({
        id: 1,
        username: 'jdoe',
        email: 'jdoe@example.com',
        full_name: 'John Doe',
        role: UserRole.DEVELOPER,
        password_hash: passwordHash,
        created_at: new Date(),
        updated_at: new Date(),
      });
      const result = await fresh.login('jdoe', 'correct-horse');
      expect(result.expiresIn).toBe(expected);
    });
  });
});
