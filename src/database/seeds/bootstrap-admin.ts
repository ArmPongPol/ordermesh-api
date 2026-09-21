import * as argon2 from 'argon2';
import dataSource from '../data-source';
import { PASSWORD_HASH_OPTIONS } from '../../auth/auth.constants';
import { ROLES } from '../../rbac/constants/roles';

/**
 * Creates the first ADMIN account.
 *
 * Deliberately a script rather than part of the migration: a migration is
 * committed to git, and an admin password committed to git is a credential in
 * git. Roles and permissions are seeded by the migration because they are
 * referenced from source code; this one is operator data and stays out.
 *
 *   BOOTSTRAP_ADMIN_EMAIL=... BOOTSTRAP_ADMIN_PASSWORD=... npm run seed:admin
 *
 * Idempotent: refuses rather than overwrites if the account already exists, so
 * it can never be used to silently reset an existing admin's password.
 */
async function bootstrapAdmin(): Promise<void> {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error(
      'Set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD before running this script.',
    );
  }

  if (password.length < 12) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must be at least 12 characters.');
  }

  await dataSource.initialize();

  try {
    await dataSource.transaction(async (manager) => {
      const existing = await manager.query<{ id: string }[]>(
        `SELECT "id" FROM "users" WHERE lower("email") = lower($1)`,
        [email],
      );

      if (existing.length > 0) {
        throw new Error(
          `A user with the email ${email} already exists. Refusing to modify it — ` +
            'grant the ADMIN role manually if that is what you intended.',
        );
      }

      const roles = await manager.query<{ id: string }[]>(
        `SELECT "id" FROM "roles" WHERE "name" = $1`,
        [ROLES.ADMIN],
      );

      if (roles.length === 0) {
        throw new Error(
          'The ADMIN role does not exist. Run `npm run migration:run` first.',
        );
      }

      const [user] = await manager.query<{ id: string }[]>(
        `INSERT INTO "users" ("email", "password_hash", "full_name", "status")
         VALUES ($1, $2, $3, 'ACTIVE')
         RETURNING "id"`,
        [
          email,
          await argon2.hash(password, PASSWORD_HASH_OPTIONS),
          'Administrator',
        ],
      );

      await manager.query<unknown>(
        `INSERT INTO "user_roles" ("user_id", "role_id") VALUES ($1, $2)`,
        [user.id, roles[0].id],
      );

      console.log(`Created ADMIN user ${email} (${user.id}).`);
    });
  } finally {
    await dataSource.destroy();
  }
}

bootstrapAdmin()
  .then(() => process.exit(0))
  .catch((error: Error) => {
    // The password must never reach the log, so only the message is printed.
    console.error(`seed:admin failed — ${error.message}`);
    process.exit(1);
  });
