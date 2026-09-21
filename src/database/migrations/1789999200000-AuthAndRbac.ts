import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Identity and access: users, roles, permissions and refresh tokens.
 *
 * Hand-written rather than produced by `migration:generate`, because `generate`
 * cannot emit any of the four things this migration most depends on:
 * the `lower(email)` expression index, the partial sweeper index, the
 * `DEFAULT now()` clauses, and the seed rows.
 *
 * Constraint and index names are NOT arbitrary. TypeORM's schema differ matches
 * CHECK constraints and foreign keys by NAME ONLY, so each one here has an
 * identically-named `@Check(...)` / `foreignKeyConstraintName` on the entity.
 * Rename one side and every future `migration:generate` emits phantom
 * DROP/CREATE churn. The `PK_`/`UQ_` hashes are the values TypeORM's
 * DefaultNamingStrategy computes for these tables and columns.
 *
 * Verify with: `npm run migration:generate` — it must report no changes.
 */

// Exported so a unit test can prove the TypeScript constants in
// src/rbac/constants/ still match what was actually seeded. Migrations are
// frozen snapshots and must never import those constants: a later edit to the
// catalogue would silently rewrite history. Drift is caught by the test instead.
export const SEEDED_PERMISSIONS: ReadonlyArray<
  readonly [code: string, resource: string, action: string, description: string]
> = [
  ['product:read', 'product', 'read', 'View products'],
  ['product:write', 'product', 'write', 'Create and edit products'],
  ['product:delete', 'product', 'delete', 'Archive or delete products'],

  ['sku:read', 'sku', 'read', 'View SKUs and prices'],
  ['sku:write', 'sku', 'write', 'Create and edit SKUs'],

  ['warehouse:read', 'warehouse', 'read', 'View warehouses'],
  ['warehouse:write', 'warehouse', 'write', 'Create and edit warehouses'],

  ['stock:read', 'stock', 'read', 'View stock balances and movements'],
  ['stock:adjust', 'stock', 'adjust', 'Record stock adjustments'],

  ['order:create', 'order', 'create', 'Place an order'],
  ['order:read', 'order', 'read', 'View own orders'],
  ['order:read:any', 'order', 'read:any', 'View any order'],
  ['order:update:any', 'order', 'update:any', 'Change the status of any order'],
  ['order:cancel', 'order', 'cancel', 'Cancel own order'],
  ['order:cancel:any', 'order', 'cancel:any', 'Cancel any order'],

  ['payment:read:any', 'payment', 'read:any', 'View any payment'],
  ['payment:refund', 'payment', 'refund', 'Issue a refund'],

  ['shipment:read:any', 'shipment', 'read:any', 'View any shipment'],
  ['shipment:create', 'shipment', 'create', 'Create a shipment'],
  [
    'shipment:update',
    'shipment',
    'update',
    'Update shipment status and tracking',
  ],

  ['user:read', 'user', 'read', 'View user accounts'],
  ['user:write', 'user', 'write', 'Create, edit and suspend user accounts'],

  ['role:read', 'role', 'read', 'View roles and their permissions'],
  ['role:assign', 'role', 'assign', 'Grant and revoke roles'],

  ['audit:read', 'audit', 'read', 'Read the audit log'],
];

export const SEEDED_ROLES: ReadonlyArray<
  readonly [name: string, description: string]
> = [
  ['ADMIN', 'Full access to every resource'],
  ['OPS_MANAGER', 'Runs catalogue, inventory and fulfilment'],
  ['WAREHOUSE_STAFF', 'Picks, packs and adjusts stock'],
  ['SUPPORT', 'Reads orders and payments to help customers'],
  ['CUSTOMER', 'Shops and manages their own orders'],
];

/**
 * ADMIN is absent on purpose — it is seeded with a CROSS JOIN so it picks up
 * every permission, including ones added by later migrations.
 */
export const SEEDED_ROLE_PERMISSIONS: Readonly<
  Record<string, readonly string[]>
> = {
  OPS_MANAGER: [
    'product:read',
    'product:write',
    'product:delete',
    'sku:read',
    'sku:write',
    'warehouse:read',
    'warehouse:write',
    'stock:read',
    'stock:adjust',
    'order:read:any',
    'order:update:any',
    'order:cancel:any',
    'payment:read:any',
    'payment:refund',
    'shipment:read:any',
    'shipment:create',
    'shipment:update',
    'audit:read',
  ],
  WAREHOUSE_STAFF: [
    'sku:read',
    'warehouse:read',
    'stock:read',
    'stock:adjust',
    'order:read:any',
    'shipment:read:any',
    'shipment:create',
    'shipment:update',
  ],
  SUPPORT: [
    'product:read',
    'sku:read',
    'order:read:any',
    'order:cancel:any',
    'payment:read:any',
    'shipment:read:any',
    'user:read',
  ],
  CUSTOMER: [
    'product:read',
    'sku:read',
    'order:create',
    'order:read',
    'order:cancel',
  ],
};

export class AuthAndRbac1789999200000 implements MigrationInterface {
  name = 'AuthAndRbac1789999200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // gen_random_uuid() is core in Postgres 13+, but the extension keeps the
    // database consistent with `uuidExtension: 'pgcrypto'` in typeorm.options.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // ---------------------------------------------------------------- users
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" character varying(320) NOT NULL,
        "password_hash" character varying(255) NOT NULL,
        "full_name" character varying(160) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'ACTIVE',
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "users_status_check"
          CHECK ("status" IN ('ACTIVE','INACTIVE','SUSPENDED')),
        CONSTRAINT "PK_a3ffb1c0c8416b9fc6f907b7433" PRIMARY KEY ("id")
      )
    `);

    // Case-insensitive uniqueness (docs/schema.dbml [FIX 3]). Deliberately NOT
    // a plain UNIQUE on "email": that is case-sensitive, so Somchai@ and
    // somchai@ would both register and race for the same identity.
    //
    // TypeORM's index loader cannot see expression indexes (their pg_index
    // indkey entry is 0), so `migration:generate` will neither recreate nor
    // drop this — it is invisible to the differ, which is what makes the
    // approach safe here. It also means nothing protects it: adding
    // `unique: true` to the entity column later would create a SECOND,
    // case-sensitive constraint and silently reopen the hole.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_users_email_lower" ON "users" (lower("email"))`,
    );

    // ---------------------------------------------------------------- roles
    await queryRunner.query(`
      CREATE TABLE "roles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "name" character varying(64) NOT NULL,
        "description" character varying(255),
        "is_system" boolean NOT NULL DEFAULT false,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_648e3f5447f725579d7d4ffdfb7" UNIQUE ("name"),
        CONSTRAINT "PK_c1433d71a4838793a49dcad46ab" PRIMARY KEY ("id")
      )
    `);

    // ---------------------------------------------------------- permissions
    await queryRunner.query(`
      CREATE TABLE "permissions" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "code" character varying(64) NOT NULL,
        "resource" character varying(32) NOT NULL,
        "action" character varying(32) NOT NULL,
        "description" character varying(255),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "permissions_code_format_check"
          CHECK ("code" ~ '^[a-z_]+:[a-z_]+(:any)?$'),
        CONSTRAINT "UQ_8dad765629e83229da6feda1c1d" UNIQUE ("code"),
        CONSTRAINT "PK_920331560282b8bd21bb02290df" PRIMARY KEY ("id")
      )
    `);

    // ----------------------------------------------------------- user_roles
    await queryRunner.query(`
      CREATE TABLE "user_roles" (
        "user_id" uuid NOT NULL,
        "role_id" uuid NOT NULL,
        "assigned_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "assigned_by" uuid,
        CONSTRAINT "PK_23ed6f04fe43066df08379fd034" PRIMARY KEY ("user_id", "role_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_user_roles_role" ON "user_roles" ("role_id")`,
    );

    // ----------------------------------------------------- role_permissions
    await queryRunner.query(`
      CREATE TABLE "role_permissions" (
        "role_id" uuid NOT NULL,
        "permission_id" uuid NOT NULL,
        "granted_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_25d24010f53bb80b78e412c9656" PRIMARY KEY ("role_id", "permission_id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_role_permissions_permission" ON "role_permissions" ("permission_id")`,
    );

    // ------------------------------------------------------- refresh_tokens
    await queryRunner.query(`
      CREATE TABLE "refresh_tokens" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "user_id" uuid NOT NULL,
        "family_id" uuid NOT NULL,
        "token_hash" character varying(255) NOT NULL,
        "user_agent" character varying(255),
        "ip" character varying(45),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "family_expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "revoked_at" TIMESTAMP WITH TIME ZONE,
        "revoked_reason" character varying(24),
        "replaced_by_token_id" uuid,
        CONSTRAINT "refresh_tokens_revoked_reason_check"
          CHECK ("revoked_reason" IS NULL OR "revoked_reason" IN
            ('ROTATED','LOGOUT','LOGOUT_ALL','REUSE_DETECTED','USER_DISABLED')),
        CONSTRAINT "refresh_tokens_expiry_order_check"
          CHECK ("expires_at" <= "family_expires_at"),
        CONSTRAINT "PK_7d8bee0204106019488c4c50ffa" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "ix_refresh_tokens_user" ON "refresh_tokens" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "ix_refresh_tokens_family" ON "refresh_tokens" ("family_id")`,
    );
    // Partial: the sweeper only ever reads live rows, and this table is
    // append-mostly so the revoked majority would bloat a full index.
    await queryRunner.query(
      `CREATE INDEX "ix_refresh_tokens_active_sweep" ON "refresh_tokens" ("expires_at") WHERE revoked_at IS NULL`,
    );

    // ---------------------------------------------------------- foreign keys
    await queryRunner.query(`
      ALTER TABLE "user_roles"
        ADD CONSTRAINT "fk_user_roles_user" FOREIGN KEY ("user_id")
        REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "user_roles"
        ADD CONSTRAINT "fk_user_roles_role" FOREIGN KEY ("role_id")
        REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    // SET NULL, not CASCADE: removing the admin who made a grant must not
    // delete the grant itself.
    await queryRunner.query(`
      ALTER TABLE "user_roles"
        ADD CONSTRAINT "fk_user_roles_assigned_by" FOREIGN KEY ("assigned_by")
        REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "role_permissions"
        ADD CONSTRAINT "fk_role_permissions_role" FOREIGN KEY ("role_id")
        REFERENCES "roles"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "role_permissions"
        ADD CONSTRAINT "fk_role_permissions_permission" FOREIGN KEY ("permission_id")
        REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);
    await queryRunner.query(`
      ALTER TABLE "refresh_tokens"
        ADD CONSTRAINT "fk_refresh_tokens_user" FOREIGN KEY ("user_id")
        REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
    `);

    // ----------------------------------------------------------------- seed
    // Permission codes are referenced from source code, so they ship with the
    // deploy rather than being operator data. Seeding them here means a freshly
    // migrated database is immediately usable; a separate seed script would
    // leave every guarded route 403ing until someone remembered to run it.
    //
    // Every statement is idempotent, so re-running never clobbers an admin's
    // later retuning of a role.
    await queryRunner.query(
      `INSERT INTO "permissions" ("code", "resource", "action", "description")
       SELECT * FROM unnest($1::varchar[], $2::varchar[], $3::varchar[], $4::varchar[])
       ON CONFLICT ("code") DO NOTHING`,
      [
        SEEDED_PERMISSIONS.map((p) => p[0]),
        SEEDED_PERMISSIONS.map((p) => p[1]),
        SEEDED_PERMISSIONS.map((p) => p[2]),
        SEEDED_PERMISSIONS.map((p) => p[3]),
      ],
    );

    await queryRunner.query(
      `INSERT INTO "roles" ("name", "description", "is_system")
       SELECT *, true FROM unnest($1::varchar[], $2::varchar[])
       ON CONFLICT ("name") DO NOTHING`,
      [SEEDED_ROLES.map((r) => r[0]), SEEDED_ROLES.map((r) => r[1])],
    );

    // ADMIN holds every permission as explicit rows — no wildcard bypass in the
    // guard. The CROSS JOIN keeps it correct as later migrations add
    // permissions, and means "who can refund a payment" is one SQL query with
    // no special case to audit.
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r."id", p."id" FROM "roles" r CROSS JOIN "permissions" p
      WHERE r."name" = 'ADMIN'
      ON CONFLICT DO NOTHING
    `);

    for (const [roleName, codes] of Object.entries(SEEDED_ROLE_PERMISSIONS)) {
      await queryRunner.query(
        `INSERT INTO "role_permissions" ("role_id", "permission_id")
         SELECT r."id", p."id" FROM "roles" r
         JOIN "permissions" p ON p."code" = ANY($2::varchar[])
         WHERE r."name" = $1
         ON CONFLICT DO NOTHING`,
        [roleName, codes],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse order. The tables are dropped outright, which takes their
    // indexes, checks and foreign keys with them.
    await queryRunner.query(`DROP TABLE "refresh_tokens"`);
    await queryRunner.query(`DROP TABLE "role_permissions"`);
    await queryRunner.query(`DROP TABLE "user_roles"`);
    await queryRunner.query(`DROP TABLE "permissions"`);
    await queryRunner.query(`DROP TABLE "roles"`);
    await queryRunner.query(`DROP TABLE "users"`);
    // pgcrypto is left installed: other migrations may already rely on it, and
    // dropping an extension is not safely reversible.
  }
}
