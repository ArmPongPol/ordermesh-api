import {
  SEEDED_PERMISSIONS,
  SEEDED_ROLES,
  SEEDED_ROLE_PERMISSIONS,
} from '../../database/migrations/1789999200000-AuthAndRbac';
import {
  ALL_PERMISSIONS,
  PERMISSION_DESCRIPTIONS,
  PermissionCode,
  splitPermission,
} from './permissions';
import {
  ALL_ROLES,
  ROLES,
  ROLE_DESCRIPTIONS,
  ROLE_PERMISSION_MATRIX,
  RoleName,
} from './roles';

/**
 * The migration is a frozen snapshot and cannot import the constants (a later
 * edit to the catalogue would silently rewrite history), so the two are
 * genuinely independent copies. That is the right trade-off, but it means they
 * can drift — a permission added to PERMISSIONS but not to a migration would
 * simply never exist in the database, and `@RequirePermissions` would 403
 * forever with nothing to point at.
 *
 * This spec is what makes the drift a build failure instead.
 */
describe('RBAC catalogue matches what the migration seeded', () => {
  const seededCodes = SEEDED_PERMISSIONS.map(([code]) => code);

  it('seeds exactly the permissions the code references', () => {
    expect([...seededCodes].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });

  it('seeds the same resource/action split the helper derives', () => {
    for (const [code, resource, action] of SEEDED_PERMISSIONS) {
      expect(splitPermission(code as PermissionCode)).toEqual({
        resource,
        action,
      });
    }
  });

  it('seeds the same description the catalogue documents', () => {
    for (const [code, , , description] of SEEDED_PERMISSIONS) {
      expect(PERMISSION_DESCRIPTIONS[code as PermissionCode]).toBe(description);
    }
  });

  it('seeds exactly the roles the code references', () => {
    const seededRoleNames = SEEDED_ROLES.map(([name]) => name);
    expect([...seededRoleNames].sort()).toEqual([...ALL_ROLES].sort());

    for (const [name, description] of SEEDED_ROLES) {
      expect(ROLE_DESCRIPTIONS[name as RoleName]).toBe(description);
    }
  });

  it('seeds the same grants the matrix declares, for every non-admin role', () => {
    for (const [roleName, codes] of Object.entries(SEEDED_ROLE_PERMISSIONS)) {
      expect([...codes].sort()).toEqual(
        [...ROLE_PERMISSION_MATRIX[roleName as RoleName]].sort(),
      );
    }
  });

  // ADMIN is seeded with a CROSS JOIN rather than an explicit list, precisely so
  // it picks up permissions added by later migrations. It must therefore NOT
  // appear in the explicit seed map, or those two mechanisms would disagree.
  it('seeds ADMIN by CROSS JOIN, not as an explicit list', () => {
    expect(SEEDED_ROLE_PERMISSIONS[ROLES.ADMIN]).toBeUndefined();
    expect(ROLE_PERMISSION_MATRIX[ROLES.ADMIN]).toEqual(ALL_PERMISSIONS);
  });

  // Every code must satisfy the permissions_code_format_check CHECK constraint,
  // otherwise the seed INSERT fails at migration time rather than in review.
  it('only uses codes the database CHECK constraint accepts', () => {
    for (const code of ALL_PERMISSIONS) {
      expect(code).toMatch(/^[a-z_]+:[a-z_]+(:any)?$/);
    }
  });

  it('grants no role a permission that does not exist', () => {
    for (const codes of Object.values(ROLE_PERMISSION_MATRIX)) {
      for (const code of codes) {
        expect(ALL_PERMISSIONS).toContain(code);
      }
    }
  });
});
