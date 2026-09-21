import {
  ExecutionContext,
  InternalServerErrorException,
  createParamDecorator,
} from '@nestjs/common';
import type { Request } from 'express';
import type { AuthenticatedUser } from '../types/authenticated-user';

/**
 * The authenticated user from `req.user`, optionally narrowed to one property:
 *
 *   `@CurrentUser() user: AuthenticatedUser`
 *   `@CurrentUser('id') userId: string`
 *
 * Throws rather than returning undefined when nothing is set. A route that is
 * `@Public()` but still asks for the current user is a coding error, and the
 * silent alternative treats every caller as anonymous — a authorization bug
 * that looks like working code.
 */
export const CurrentUser = createParamDecorator(
  (
    property: keyof AuthenticatedUser | undefined,
    context: ExecutionContext,
  ) => {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;

    if (!user) {
      throw new InternalServerErrorException(
        'No authenticated user on the request: this route is @Public() or missing the auth guard',
      );
    }

    return property ? user[property] : user;
  },
);
