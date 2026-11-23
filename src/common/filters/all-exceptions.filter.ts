import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiResponse } from '../interfaces/response.interface.js';

// Diport dari nest-common (all-exceptions.filter.ts). Fail closed: teks error
// mentah hanya dikirim ke client bila NODE_ENV eksplisit development/test.
function exposesInternalErrors(): boolean {
  return ['development', 'test'].includes(process.env.NODE_ENV ?? '');
}

const MAX_MESSAGE_LENGTH = 1000;

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: string | null = null;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();

      if (typeof res === 'object' && res !== null && 'message' in res) {
        // ValidationPipe mengembalikan message berupa array string.
        const raw = (res as { message: string | string[] }).message;
        message = Array.isArray(raw) ? raw.join(', ') : raw;
        details = (res as { error?: string }).error ?? null;
      } else {
        message = typeof res === 'string' ? res : exception.message;
      }

      // Pesan 5xx sering dibangun dari error internal; jangan dikirim ke client.
      if (status >= 500 && !exposesInternalErrors()) {
        message = 'Internal server error';
        details = null;
      }
    } else if (
      exception instanceof Error &&
      exception.name === 'QueryFailedError'
    ) {
      // Error database tidak boleh membocorkan SQL mentah.
      status = HttpStatus.BAD_REQUEST;
      message =
        'Operation failed due to invalid data format or constraint violation.';
      details = exposesInternalErrors() ? exception.message : null;
    } else if (exception instanceof Error) {
      // Error tak dikenal (mis. koneksi DB) bisa membawa host internal.
      if (exposesInternalErrors()) message = exception.message;
    } else if (typeof exception === 'string') {
      if (exposesInternalErrors()) message = exception;
    } else {
      message = 'An unexpected error occurred';
    }

    if (status >= 500) {
      // Lewat Nest Logger supaya masuk ke pino (bukan console.error).
      this.logger.error(
        `${status} - ${message}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiResponse<string | null> = {
      code: status,
      status: 'error',
      message: message.substring(0, MAX_MESSAGE_LENGTH),
      data: details,
    };

    response.status(status).json(body);
  }
}
