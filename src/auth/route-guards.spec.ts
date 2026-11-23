import {
  Controller,
  Get,
  Post,
  UseGuards,
  type CanActivate,
} from '@nestjs/common';
import {
  collectControllers,
  describeRoutes,
  findUnprotectedRoutes,
} from '../../test/route-audit.js';
import { Public } from './decorators/public.decorator.js';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';

// Guard dipasang per route (bukan global), jadi route baru yang lupa diberi
// guard akan terbuka. Tes ini menutup celah itu: setiap route harus dijaga
// JwtAuthGuard atau ditandai @Public() secara sadar.
describe('proteksi route', () => {
  async function appRoutes() {
    // ConfigModule memvalidasi env saat modul dibuat.
    vi.stubEnv('JWT_SECRET', 'a'.repeat(48)); // secret-scan:ignore nilai palsu untuk test
    const { AppModule } = await import('../app.module.js');
    return describeRoutes(collectControllers(AppModule));
  }

  afterAll(() => vi.unstubAllEnvs());

  it('setiap route di aplikasi dijaga JwtAuthGuard atau ditandai @Public()', async () => {
    const routes = await appRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(5); // jangan lulus karena tidak menemukan apa pun
    expect(findUnprotectedRoutes(routes, 'JwtAuthGuard')).toEqual([]);
  });

  it('daftar route publik adalah yang disengaja saja (menambah satu harus mengubah tes ini)', async () => {
    const publicRoutes = (await appRoutes())
      .filter((r) => r.isPublic)
      .map((r) => r.route)
      .sort();
    expect(publicRoutes).toEqual(
      ['GET /health', 'POST /auth/login', 'POST /auth/refresh'].sort(),
    );
  });

  describe('pemeriksa itu sendiri (supaya tidak lulus diam-diam)', () => {
    class OtherGuard implements CanActivate {
      canActivate() {
        return true;
      }
    }

    @Controller('demo')
    class DemoController {
      @Get('terbuka-tanpa-guard')
      lupa() {}

      @UseGuards(OtherGuard)
      @Get('guard-lain')
      guardLain() {}

      @UseGuards(JwtAuthGuard)
      @Get('aman')
      aman() {}

      @Public()
      @Post('publik')
      publik() {}
    }

    @UseGuards(JwtAuthGuard)
    @Controller('kelas')
    class GuardedClassController {
      @Get('satu')
      satu() {}
    }

    it('menandai route tanpa guard dan route yang hanya punya guard lain', () => {
      const routes = describeRoutes([DemoController, GuardedClassController]);
      expect(findUnprotectedRoutes(routes, 'JwtAuthGuard').sort()).toEqual([
        'GET /demo/guard-lain',
        'GET /demo/terbuka-tanpa-guard',
      ]);
    });

    it('guard di level controller dan @Public() dihitung', () => {
      const routes = describeRoutes([DemoController, GuardedClassController]);
      const flagged = findUnprotectedRoutes(routes, 'JwtAuthGuard');
      expect(flagged).not.toContain('GET /kelas/satu');
      expect(flagged).not.toContain('POST /demo/publik');
      expect(flagged).not.toContain('GET /demo/aman');
    });
  });
});
