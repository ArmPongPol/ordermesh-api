import { SetMetadata } from '@nestjs/common';
import type { PermissionCode } from '../constants/permissions';

export const REQUIRE_PERMISSIONS_KEY = 'rbac:requirePermissions';

export interface PermissionRequirement {
  /** Every code must be held (AND). */
  all?: readonly PermissionCode[];
  /** At least one code must be held (OR). */
  any?: readonly PermissionCode[];
}

/**
 * Declares what the caller must hold to reach this route.
 *
 *   `@RequirePermissions('order:update:any')`
 *   `@RequirePermissions('order:read:any', 'payment:read:any')`  // AND
 *   `@RequirePermissions({ any: ['order:cancel', 'order:cancel:any'] })`  // OR
 *
 * Listing several codes means all of them: the stricter reading is the safe
 * default, since a guard that silently accepted "any of these" would grant more
 * than the author wrote. Use the object form to ask for OR explicitly.
 *
 * Codes are typed, so a typo is a compile error rather than a route that 403s
 * forever against a permission that does not exist.
 */
export function RequirePermissions(
  ...permissions: readonly PermissionCode[]
): MethodDecorator & ClassDecorator;
export function RequirePermissions(
  requirement: PermissionRequirement,
): MethodDecorator & ClassDecorator;
export function RequirePermissions(
  ...args: readonly PermissionCode[] | [PermissionRequirement]
): MethodDecorator & ClassDecorator {
  const [first] = args;
  const requirement: PermissionRequirement =
    typeof first === 'object' && first !== null
      ? first
      : { all: args as readonly PermissionCode[] };

  return SetMetadata(REQUIRE_PERMISSIONS_KEY, requirement);
}
