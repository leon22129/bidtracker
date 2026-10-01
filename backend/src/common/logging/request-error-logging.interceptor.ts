import {
  CallHandler,
  ExecutionContext,
  HttpException,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, catchError, throwError } from 'rxjs';
import { errorFields, logEvent } from './structured-logger';

@Injectable()
export class RequestErrorLoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Http');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest();
    return next.handle().pipe(
      catchError((error: unknown) => {
        logEvent(this.logger, 'error', 'http_request_failed', {
          method: request.method,
          path: request.path,
          status_code: error instanceof HttpException ? error.getStatus() : 500,
          user_id: request.user?.id,
          ...errorFields(error),
        });
        return throwError(() => error);
      }),
    );
  }
}
