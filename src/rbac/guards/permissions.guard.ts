import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  insufficientPermissions,
  invalidToken,
} from '../../common/exceptions/app.exception';
import {
  PermissionRequirement,
  REQUIRE_PERMISSIONS_KEY,
} from '../decorators/require-permissions.decorator';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }

    const requirement = this.reflector.getAllAndOverride<PermissionRequirement>(
      REQUIRE_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // No declaration means the route is satisfied by authentication alone.
    // Authorization is opt-in per route; JwtAuthGuard is what is global.
    if (!requirement) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user;

    // A route that declares permissions but has no authenticated user is a
    // wiring mistake (`@Public()` on something that needs authorization).
    // Fail closed.
    if (!user) {
      throw invalidToken('Missing bearer token');
    }

    const held = new Set<string>(user.permissions);

    const missingAll = (requirement.all ?? []).filter(
      (code) => !held.has(code),
    );
    if (missingAll.length > 0) {
      throw insufficientPermissions(missingAll);
    }

    const anyOf = requirement.any ?? [];
    if (anyOf.length > 0 && !anyOf.some((code) => held.has(code))) {
      // Naming the alternatives is safe: it describes the caller's own grants,
      // not whether any particular record exists.
      throw insufficientPermissions([anyOf.join(' or ')]);
    }

    return true;
  }
}
