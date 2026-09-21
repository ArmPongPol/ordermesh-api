import { ALL_PERMISSIONS, PERMISSIONS, PermissionCode } from './permissions';

export const ROLES = {
  ADMIN: 'ADMIN',
  OPS_MANAGER: 'OPS_MANAGER',
  WAREHOUSE_STAFF: 'WAREHOUSE_STAFF',
  SUPPORT: 'SUPPORT',
  CUSTOMER: 'CUSTOMER',
} as const;

export type RoleName = (typeof ROLES)[keyof typeof ROLES];

/** Assigned automatically to every self-registered account. */
export const DEFAULT_ROLE: RoleName = ROLES.CUSTOMER;

export const ROLE_DESCRIPTIONS: Record<RoleName, string> = {
  [ROLES.ADMIN]: 'Full access to every resource',
  [ROLES.OPS_MANAGER]: 'Runs catalogue, inventory and fulfilment',
  [ROLES.WAREHOUSE_STAFF]: 'Picks, packs and adjusts stock',
  [ROLES.SUPPORT]: 'Reads orders and payments to help customers',
  [ROLES.CUSTOMER]: 'Shops and manages their own orders',
};

/**
 * The seeded role → permission grants.
 *
 * ADMIN holds every permission as explicit rows rather than via a wildcard
 * bypass in the guard. That costs a CROSS JOIN in the migration and buys two
 * things: "who can refund a payment" is answerable with one SQL query, and
 * there is no special case in the authorization path to audit.
 *
 * These are *initial* grants. An admin retunes them through the API afterwards
 * and the migration's `ON CONFLICT DO NOTHING` will not clobber that.
 */
export const ROLE_PERMISSION_MATRIX: Record<
  RoleName,
  readonly PermissionCode[]
> = {
  [ROLES.ADMIN]: ALL_PERMISSIONS,

  [ROLES.OPS_MANAGER]: [
    PERMISSIONS.PRODUCT_READ,
    PERMISSIONS.PRODUCT_WRITE,
    PERMISSIONS.PRODUCT_DELETE,
    PERMISSIONS.SKU_READ,
    PERMISSIONS.SKU_WRITE,
    PERMISSIONS.WAREHOUSE_READ,
    PERMISSIONS.WAREHOUSE_WRITE,
    PERMISSIONS.STOCK_READ,
    PERMISSIONS.STOCK_ADJUST,
    PERMISSIONS.ORDER_READ_ANY,
    PERMISSIONS.ORDER_UPDATE_ANY,
    PERMISSIONS.ORDER_CANCEL_ANY,
    PERMISSIONS.PAYMENT_READ_ANY,
    PERMISSIONS.PAYMENT_REFUND,
    PERMISSIONS.SHIPMENT_READ_ANY,
    PERMISSIONS.SHIPMENT_CREATE,
    PERMISSIONS.SHIPMENT_UPDATE,
    PERMISSIONS.AUDIT_READ,
  ],

  [ROLES.WAREHOUSE_STAFF]: [
    PERMISSIONS.SKU_READ,
    PERMISSIONS.WAREHOUSE_READ,
    PERMISSIONS.STOCK_READ,
    PERMISSIONS.STOCK_ADJUST,
    PERMISSIONS.ORDER_READ_ANY,
    PERMISSIONS.SHIPMENT_READ_ANY,
    PERMISSIONS.SHIPMENT_CREATE,
    PERMISSIONS.SHIPMENT_UPDATE,
  ],

  [ROLES.SUPPORT]: [
    PERMISSIONS.PRODUCT_READ,
    PERMISSIONS.SKU_READ,
    PERMISSIONS.ORDER_READ_ANY,
    PERMISSIONS.ORDER_CANCEL_ANY,
    PERMISSIONS.PAYMENT_READ_ANY,
    PERMISSIONS.SHIPMENT_READ_ANY,
    PERMISSIONS.USER_READ,
  ],

  // Note: order:read (own) is only fully enforceable once customer_profiles
  // exists — orders.customer_id references that table, not users.
  [ROLES.CUSTOMER]: [
    PERMISSIONS.PRODUCT_READ,
    PERMISSIONS.SKU_READ,
    PERMISSIONS.ORDER_CREATE,
    PERMISSIONS.ORDER_READ,
    PERMISSIONS.ORDER_CANCEL,
  ],
};

export const ALL_ROLES = Object.values(ROLES) as RoleName[];
