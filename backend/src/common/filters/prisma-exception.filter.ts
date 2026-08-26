import {
  ArgumentsHost, Catch, ExceptionFilter, HttpStatus, Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Response } from 'express';

/**
 * Turns Prisma's error codes into sensible HTTP responses.
 *
 * Without this, a duplicate username surfaces as a 500 with a stack trace, which is both a bad UX and
 * an information leak. The messages here are deliberately generic about internals.
 */
@Catch(Prisma.PrismaClientKnownRequestError, Prisma.PrismaClientValidationError)
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('PrismaException');

  catch(exception: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof Prisma.PrismaClientValidationError) {
      this.logger.error(exception.message);
      return res.status(HttpStatus.BAD_REQUEST).json({
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'The request data did not match what the database expects.',
      });
    }

    const target = ([] as string[]).concat((exception.meta?.target as any) ?? []).join(', ');

    switch (exception.code) {
      case 'P2002':
        return res.status(HttpStatus.CONFLICT).json({
          statusCode: HttpStatus.CONFLICT,
          message: target
            ? `A record with that ${humanise(target)} already exists.`
            : 'That record already exists.',
        });
      case 'P2003':
      case 'P2014':
        return res.status(HttpStatus.BAD_REQUEST).json({
          statusCode: HttpStatus.BAD_REQUEST,
          message: 'A related record is missing or still referenced.',
        });
      case 'P2025':
        return res.status(HttpStatus.NOT_FOUND).json({
          statusCode: HttpStatus.NOT_FOUND,
          message: 'The requested record no longer exists.',
        });
      default:
        this.logger.error(`Unhandled Prisma error ${exception.code}: ${exception.message}`);
        return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
          statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
          message: 'Unexpected database error.',
        });
    }
  }
}

function humanise(target: string): string {
  return target
    .replace(/_/g, ' ')
    .replace(/\bid\b/g, 'identifier')
    .trim();
}
