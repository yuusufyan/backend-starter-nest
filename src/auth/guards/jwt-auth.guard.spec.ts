import { type ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JWT_ISSUER } from '../auth.constants.js';
import type { AuthenticatedRequest } from '../interfaces/auth-user.interface.js';
import { JwtAuthGuard } from './jwt-auth.guard.js';
import { buildJwtOptions } from '../jwt.options.js';
import type {
  AuthProfile,
  UsersRepository,
} from '../../users/users.repository.js';

const SECRET = 'a'.repeat(48); // secret-scan:ignore nilai palsu untuk test
const profile: AuthProfile = {
  id: 'u1',
  email: 'a@example.com',
  name: 'Admin',
  isActive: true,
  role: 'superadmin',
};

describe('JwtAuthGuard', () => {
  const jwt = new JwtService(buildJwtOptions(SECRET));
  // Penempa token untuk skenario serangan: tanpa opsi bawaan, kita yang atur klaimnya.
  const forger = new JwtService({ secret: SECRET });
  const findAuthProfile = vi.fn<UsersRepository['findAuthProfile']>();
  const guard = new JwtAuthGuard(jwt, {
    findAuthProfile,
  } as unknown as UsersRepository);

  const run = (authorization?: string) => {
    const request: AuthenticatedRequest = { headers: { authorization } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { request, result: guard.canActivate(context) };
  };

  const now = () => Math.floor(Date.now() / 1000);
  const forge = (
    claims: Record<string, unknown>,
    algorithm: 'HS256' | 'HS512' = 'HS256',
  ) => forger.signAsync(claims, { algorithm });

  beforeEach(() => {
    findAuthProfile.mockReset();
    findAuthProfile.mockResolvedValue(profile);
  });

  it('menerima token valid dan mengisi request.user dari data segar di DB', async () => {
    const token = await jwt.signAsync({ sub: 'u1' });
    const { request, result } = run(`Bearer ${token}`);

    await expect(result).resolves.toBe(true);
    expect(findAuthProfile).toHaveBeenCalledWith('u1');
    expect(request.user).toEqual({
      id: 'u1',
      email: 'a@example.com',
      name: 'Admin',
      role: 'superadmin',
    });
  });

  it.each([
    ['tanpa header', undefined],
    ['skema bukan Bearer', 'Basic dXNlcjpwYXNz'],
    ['Bearer kosong', 'Bearer '],
    ['Bearer dengan spasi/karakter aneh', 'Bearer a b'],
  ])('menolak: %s', async (_nama, header) => {
    await expect(run(header).result).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findAuthProfile).not.toHaveBeenCalled();
  });

  it('menolak token yang ditandatangani rahasia lain', async () => {
    const asing = await new JwtService({ secret: 'b'.repeat(48) }).signAsync(
      // secret-scan:ignore nilai palsu untuk test
      { sub: 'u1', iss: JWT_ISSUER },
    );
    await expect(run(`Bearer ${asing}`).result).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('menolak token kedaluwarsa', async () => {
    const token = await forge({ sub: 'u1', iss: JWT_ISSUER, exp: now() - 10 });
    await expect(run(`Bearer ${token}`).result).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('menolak issuer yang salah dan token tanpa issuer', async () => {
    const salah = await forge({
      sub: 'u1',
      iss: 'penerbit-lain',
      exp: now() + 60,
    });
    const tanpa = await forge({ sub: 'u1', exp: now() + 60 });
    await expect(run(`Bearer ${salah}`).result).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(run(`Bearer ${tanpa}`).result).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('menolak algoritma selain HS256, termasuk "none" dan HS512 dengan rahasia yang sama', async () => {
    const b64 = (o: object) =>
      Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'u1', iss: JWT_ISSUER, exp: now() + 60 })}.`;
    const hs512 = await forge(
      { sub: 'u1', iss: JWT_ISSUER, exp: now() + 60 },
      'HS512',
    );

    await expect(run(`Bearer ${none}`).result).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(run(`Bearer ${hs512}`).result).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findAuthProfile).not.toHaveBeenCalled();
  });

  it('menolak token tanpa sub bertipe string', async () => {
    const tanpaSub = await jwt.signAsync({ foo: 'bar' });
    const subAngka = await jwt.signAsync({ sub: 123 as unknown as string });
    await expect(run(`Bearer ${tanpaSub}`).result).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(run(`Bearer ${subAngka}`).result).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('menolak user yang tidak ada atau dinonaktifkan walau token masih berlaku', async () => {
    const token = await jwt.signAsync({ sub: 'u1' });

    findAuthProfile.mockResolvedValueOnce(undefined);
    await expect(run(`Bearer ${token}`).result).rejects.toBeInstanceOf(
      UnauthorizedException,
    );

    findAuthProfile.mockResolvedValueOnce({ ...profile, isActive: false });
    await expect(run(`Bearer ${token}`).result).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('semua penolakan memakai pesan generik (tidak membocorkan alasan)', async () => {
    const token = await forge({ sub: 'u1', iss: JWT_ISSUER, exp: now() - 10 });
    const err = await run(`Bearer ${token}`).result.catch((e: unknown) => e);
    expect((err as UnauthorizedException).message).toBe('Unauthorized');
  });
});
