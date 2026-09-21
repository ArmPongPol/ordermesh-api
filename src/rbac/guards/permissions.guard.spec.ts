import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ErrorCode } from '../../common/constants/error-code';
import { AppHttpException } from '../../common/exceptions/app.exception';
import type { AuthenticatedUser } from '../../auth/types/authenticated-user';
import { PERMISSIONS } from '../constants/permissions';
import { PermissionRequirement } from '../decorators/require-permissions.decorator';
import { PermissionsGuard } from './permissions.guard';

function makeUser(permissions: string[]): AuthenticatedUser {
  return {
    id: 'user-1',
    email: 'staff@example.com',
    fullName: 'Staff',
    status: 'ACTIVE',
    roles: ['WAREHOUSE_STAFF'],
    permissions: permissions as AuthenticatedUser['permissions'],
  };
}

function run(
  requirement: PermissionRequirement | undefined,
  user: AuthenticatedUser | undefined,
) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(requirement),
  } as unknown as Reflector;

  const context = {
    getType: () => 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;

  return () => new PermissionsGuard(reflector).canActivate(context);
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (error) {
    return (error as AppHttpException).code;
  }
  throw new Error('expected the call to throw');
}

describe('PermissionsGuard', () => {
  // Authorization is opt-in per route; authentication is what is global. A
  // route with no declaration is satisfied by being authenticated.
  it('allows a route that declares no permissions', () => {
    expect(run(undefined, makeUser([]))()).toBe(true);
  });

  it('allows when every required permission is held', () => {
    const requirement = {
      all: [PERMISSIONS.STOCK_READ, PERMISSIONS.STOCK_ADJUST],
    };

    expect(run(requirement, makeUser(['stock:read', 'stock:adjust']))()).toBe(
      true,
    );
  });

  // Listing several codes means AND. If this ever became OR, every multi-code
  // route in the codebase would silently start granting more than it says.
  it('denies when only some of the required permissions are held', () => {
    const requirement = {
      all: [PERMISSIONS.STOCK_READ, PERMISSIONS.STOCK_ADJUST],
    };

    expect(codeOf(run(requirement, makeUser(['stock:read'])))).toBe(
      ErrorCode.INSUFFICIENT_PERMISSIONS,
    );
  });

  it('allows when any one of an OR requirement is held', () => {
    const requirement = {
      any: [PERMISSIONS.ORDER_CANCEL, PERMISSIONS.ORDER_CANCEL_ANY],
    };

    expect(run(requirement, makeUser(['order:cancel:any']))()).toBe(true);
    expect(run(requirement, makeUser(['order:cancel']))()).toBe(true);
    expect(codeOf(run(requirement, makeUser(['order:read'])))).toBe(
      ErrorCode.INSUFFICIENT_PERMISSIONS,
    );
  });

  it('names the missing permission so the 403 is actionable', () => {
    const requirement = { all: [PERMISSIONS.PAYMENT_REFUND] };
    let message = '';

    try {
      run(requirement, makeUser([]))();
    } catch (error) {
      ({ message } = (error as AppHttpException).getResponse() as {
        message: string;
      });
    }

    expect(message).toContain('payment:refund');
  });

  // Fail closed. A route declaring permissions with no authenticated user is a
  // wiring mistake — @Public() on something that needs authorization — and must
  // never be read as "no permissions required".
  it('rejects rather than allows when the route has no authenticated user', () => {
    expect(codeOf(run({ all: [PERMISSIONS.USER_READ] }, undefined))).toBe(
      ErrorCode.INVALID_TOKEN,
    );
  });

  it('denies a user holding no permissions at all', () => {
    expect(codeOf(run({ all: [PERMISSIONS.AUDIT_READ] }, makeUser([])))).toBe(
      ErrorCode.INSUFFICIENT_PERMISSIONS,
    );
  });

  // `order:read` must not satisfy `order:read:any` by prefix. They are
  // different grants: own records versus everyone's.
  it('matches codes exactly, never by prefix', () => {
    expect(
      codeOf(
        run({ all: [PERMISSIONS.ORDER_READ_ANY] }, makeUser(['order:read'])),
      ),
    ).toBe(ErrorCode.INSUFFICIENT_PERMISSIONS);
  });
});
