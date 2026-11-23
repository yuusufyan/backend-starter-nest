import { pino } from 'pino';
import { getPinoConfig } from './logger.config.js';

type HttpOptions = NonNullable<ReturnType<typeof getPinoConfig>['pinoHttp']> & {
  redact: { paths: string[]; censor: string };
  autoLogging: { ignore: (req: { url?: string }) => boolean };
};

const options = () => getPinoConfig('test-svc').pinoHttp as HttpOptions;

describe('getPinoConfig', () => {
  it('me-redact field sensitif sampai kedalaman yang dienumerasi', () => {
    const lines: string[] = [];
    const logger = pino(
      { redact: options().redact },
      { write: (line: string) => lines.push(line) },
    );

    logger.info({
      password: 'p1',
      user: { passwordHash: 'hash-rahasia', password_hash: 'hash-rahasia-2' }, // secret-scan:ignore nilai palsu untuk test
      a: { token: 't1', b: { email: 'e@x.id' } },
    });

    const out = lines.join('');
    expect(out).not.toContain('p1');
    expect(out).not.toContain('hash-rahasia');
    expect(out).not.toContain('t1');
    expect(out).not.toContain('e@x.id');
    expect(out).toContain('[REDACTED]');
  });

  it('tidak mencatat /health, /metrics (termasuk dengan query string)', () => {
    const { ignore } = options().autoLogging;
    expect(ignore({ url: '/health' })).toBe(true);
    expect(ignore({ url: '/metrics?x=1' })).toBe(true);
    expect(ignore({ url: '/users' })).toBe(false);
  });
});
