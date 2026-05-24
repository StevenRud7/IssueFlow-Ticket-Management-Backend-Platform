import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DatabaseError } from 'pg';

/**
 * Translates raw PostgreSQL errors into proper HTTP responses with helpful
 * messages, instead of letting them surface as opaque 500s. This is purely
 * defence-in-depth — services should ideally pre-validate constraints — but
 * when they don't (concurrent inserts, race conditions, etc.), the client
 * still gets a useful 4xx response.
 *
 * SQLSTATE codes handled:
 *   23505 - unique_violation       → 409 Conflict
 *   23503 - foreign_key_violation  → 400 Bad Request  ("referenced X not found")
 *   23514 - check_violation        → 400 Bad Request
 *   22P02 - invalid_text_representation (bad enum / bad UUID) → 400
 *
 * Anything else falls through to AllExceptionsFilter.
 */
@Catch(DatabaseError)
export class PgExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PgExceptionFilter.name);

  catch(exception: DatabaseError, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Database error';
    let error = 'Internal Server Error';

    switch (exception.code) {
      case '23505': {
        // unique_violation — pg surfaces the constraint name in `constraint`
        // and the offending column(s) in `detail`. We expose `detail` because
        // it's safe (it doesn't leak values that weren't in the request).
        status = HttpStatus.CONFLICT;
        error = 'Conflict';
        message = exception.detail
          ? `Unique constraint violated: ${exception.detail}`
          : 'A record with these values already exists';
        break;
      }
      case '23503': {
        // foreign_key_violation
        status = HttpStatus.BAD_REQUEST;
        error = 'Bad Request';
        message = exception.detail
          ? `Foreign key violation: ${exception.detail}`
          : 'Referenced record does not exist';
        break;
      }
      case '23514': {
        // check_violation (e.g. ticket_id <> blocker_id)
        status = HttpStatus.BAD_REQUEST;
        error = 'Bad Request';
        message = `Constraint violation: ${exception.constraint ?? 'unknown'}`;
        break;
      }
      case '22P02': {
        // invalid_text_representation — bad enum value, bad numeric, etc.
        status = HttpStatus.BAD_REQUEST;
        error = 'Bad Request';
        message = 'Invalid value supplied for one of the request fields';
        break;
      }
      default: {
        this.logger.error(
          `Unhandled pg error ${exception.code} on ${request.method} ${request.url}: ${exception.message}`,
          exception.stack,
        );
      }
    }

    response.status(status).json({
      statusCode: status,
      error,
      message,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
