import {
  ArgumentsHost,
  BadRequestException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter.js';

function run(exception: unknown) {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({ getResponse: () => ({ status }) }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { status, body: json.mock.calls[0][0] };
}

describe('AllExceptionsFilter', () => {
  const env = process.env.NODE_ENV;
  beforeEach(() => {
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    process.env.NODE_ENV = env;
  });

  it('menggabungkan message array dari ValidationPipe', () => {
    const { status, body } = run(
      new BadRequestException({
        message: ['a salah', 'b salah'],
        error: 'Bad Request',
      }),
    );
    expect(status).toHaveBeenCalledWith(400);
    expect(body).toMatchObject({
      code: 400,
      status: 'error',
      message: 'a salah, b salah',
    });
  });

  it('production: tidak membocorkan pesan 5xx maupun error mentah', () => {
    process.env.NODE_ENV = 'production';
    expect(
      run(new InternalServerErrorException('host=db.internal')).body.message,
    ).toBe('Internal server error');
    expect(run(new Error('connect ECONNREFUSED 10.0.0.5')).body.message).toBe(
      'Internal server error',
    );
  });

  it('QueryFailedError menjadi 400 tanpa SQL di production', () => {
    process.env.NODE_ENV = 'production';
    const err = Object.assign(new Error('INSERT INTO users ...'), {
      name: 'QueryFailedError',
    });
    const { status, body } = run(err);
    expect(status).toHaveBeenCalledWith(400);
    expect(body.data).toBeNull();
    expect(body.message).not.toContain('INSERT');
  });
});
