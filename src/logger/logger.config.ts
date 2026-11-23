import { randomUUID } from 'node:crypto';
import type { Params } from 'nestjs-pino';

// Diport dari nest-common (logger.config.ts), disesuaikan ke ESM tanpa uuid.

// Nama field yang di-redact di setiap kedalaman yang dienumerasi di bawah.
const REDACT_KEY_NAMES = [
  'password',
  'newPassword',
  'oldPassword',
  'confirmPassword',
  'currentPassword',
  'passwordHash',
  'password_hash',
  'passwd',
  'pwd',
  'secret',
  'apiSecret',
  'clientSecret',
  'token',
  'accessToken',
  'refreshToken',
  'apiKey',
  'api_key',
  'authorization',
  'cookie',
  'email',
  'phone',
  'phone_number',
  'nik',
  'npwp',
  'account_number',
  'account_no',
  'accountNo',
  'rekening',
  'no_rekening',
  'no_hp',
  'no_telp',
  'alamat',
];

// Sintaks redact pino tidak punya wildcard any-depth: `*` hanya mengonsumsi
// tepat satu segmen path, dan `**` diam-diam tidak melakukan apa-apa. Jadi
// kedalaman dienumerasi eksplisit. Ini jaring pengaman best-effort untuk
// `logger.info(obj)` dengan nesting dangkal, bukan pengganti masking rekursif.
const REDACT_MAX_DEPTH = 4;

function buildRedactPaths(): string[] {
  const paths: string[] = [
    'req.headers.authorization',
    'req.headers.cookie',
    'res.headers["set-cookie"]',
  ];
  for (const key of REDACT_KEY_NAMES) {
    let prefix = '';
    for (let depth = 0; depth <= REDACT_MAX_DEPTH; depth++) {
      paths.push(prefix + key);
      prefix += '*.';
    }
  }
  return paths;
}

// Harus sama dengan path health/metrics yang dipakai nest-common.
const IGNORED_PATHS = new Set(['/health', '/metrics', '/favicon.ico']);

export const getPinoConfig = (serviceName?: string): Params => {
  const name = serviceName || process.env.SERVICE_NAME || 'unknown-service';
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    pinoHttp: {
      name,
      level: isProduction ? 'info' : 'debug',
      genReqId: (req) => {
        const header =
          req.headers['x-correlation-id'] ??
          req.headers['x-request-id'] ??
          req.headers['x-trace-id'];
        return (Array.isArray(header) ? header[0] : header) || randomUUID();
      },
      // Health check tidak perlu memenuhi log.
      autoLogging: {
        ignore: (req) => IGNORED_PATHS.has((req.url ?? '').split('?')[0]),
      },
      redact: {
        paths: buildRedactPaths(),
        censor: '[REDACTED]',
      },
      transport: isProduction
        ? undefined
        : {
            target: 'pino-pretty',
            options: {
              colorize: true,
              singleLine: true,
              translateTime: 'SYS:standard',
            },
          },
      customProps: () => ({ context: 'HTTP' }),
      serializers: {
        req: (req) => ({ method: req.method, url: req.url, id: req.id }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      customSuccessMessage: (req, res, responseTime) =>
        `HTTP ${req.method} ${req.url} ${res.statusCode} - ${responseTime}ms`,
      customErrorMessage: (req, res, err) =>
        `HTTP ${req.method} ${req.url} ${res.statusCode} - Error: ${err.message}`,
    },
  };
};
