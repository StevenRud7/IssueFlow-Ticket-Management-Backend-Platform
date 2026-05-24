import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/**
 * Shapes every uncaught error into a consistent JSON envelope so clients can
 * always rely on the same fields (§4.1 "in case of error, make sure to return
 * an informative error").
 *
 * Response shape:
 *   {
 *     statusCode: number,
 *     error:      string,    // short label, e.g. "Bad Request"
 *     message:    string | string[],  // human-readable detail(s)
 *     timestamp:  string,    // ISO-8601
 *     path:       string     // request path that produced the error
 *   }
 *
 * Known HttpExceptions pass through with their own status; everything else
 * becomes a 500 and is logged with its stack trace. Stack traces are never
 * returned to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let error = 'Internal Server Error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
        error = exception.name.replace(/Exception$/, '');
      } else if (typeof res === 'object' && res !== null) {
        const body = res as Record<string, unknown>;
        message =
          (body.message as string | string[]) ?? exception.message ?? 'Error';
        error =
          (body.error as string) ?? exception.name.replace(/Exception$/, '');
      }
    } else if (exception instanceof Error) {
      // Unknown / unexpected — log full detail server-side, return generic
      // 500 to the client to avoid leaking internals.
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}: ${exception.message}`,
        exception.stack,
      );
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
