/**
 * Permission catalogue.
 *
 * Naming: `<resource>:<action>`, lowercase snake, singular resource. A trailing
 * `:any` means "across all owners"; the bare form means "own records only".
 *
 * That distinction is load-bearing and cannot be expressed by the code alone —
 * `order:read` does not say whose orders. The rule, applied in the service
 * layer and nowhere else, is:
 *
 *   holds `order:read:any` -> no owner filter
 *   else holds `order:read` -> filter to the caller's own records
 *   else                    -> 403
 *
 * These codes are referenced from source (`@RequirePermissions(...)`), so they
 * are part of the deploy artifact, not operator data — which is why the
 * migration seeds them rather than a separate script.
 */
export const PERMISSIONS = {
  PRODUCT_READ: 'product:read',
  PRODUCT_WRITE: 'product:write',
  PRODUCT_DELETE: 'product:delete',

  SKU_READ: 'sku:read',
  SKU_WRITE: 'sku:write',

  WAREHOUSE_READ: 'warehouse:read',
  WAREHOUSE_WRITE: 'warehouse:write',

  STOCK_READ: 'stock:read',
  STOCK_ADJUST: 'stock:adjust',

  ORDER_CREATE: 'order:create',
  ORDER_READ: 'order:read',
  ORDER_READ_ANY: 'order:read:any',
  ORDER_UPDATE_ANY: 'order:update:any',
  ORDER_CANCEL: 'order:cancel',
  ORDER_CANCEL_ANY: 'order:cancel:any',

  PAYMENT_READ_ANY: 'payment:read:any',
  PAYMENT_REFUND: 'payment:refund',

  SHIPMENT_READ_ANY: 'shipment:read:any',
  SHIPMENT_CREATE: 'shipment:create',
  SHIPMENT_UPDATE: 'shipment:update',

  USER_READ: 'user:read',
  USER_WRITE: 'user:write',

  ROLE_READ: 'role:read',
  ROLE_ASSIGN: 'role:assign',

  AUDIT_READ: 'audit:read',
} as const;

export type PermissionCode = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as PermissionCode[];

/** Human-readable text seeded into `permissions.description`. */
export const PERMISSION_DESCRIPTIONS: Record<PermissionCode, string> = {
  [PERMISSIONS.PRODUCT_READ]: 'View products',
  [PERMISSIONS.PRODUCT_WRITE]: 'Create and edit products',
  [PERMISSIONS.PRODUCT_DELETE]: 'Archive or delete products',

  [PERMISSIONS.SKU_READ]: 'View SKUs and prices',
  [PERMISSIONS.SKU_WRITE]: 'Create and edit SKUs',

  [PERMISSIONS.WAREHOUSE_READ]: 'View warehouses',
  [PERMISSIONS.WAREHOUSE_WRITE]: 'Create and edit warehouses',

  [PERMISSIONS.STOCK_READ]: 'View stock balances and movements',
  [PERMISSIONS.STOCK_ADJUST]: 'Record stock adjustments',

  [PERMISSIONS.ORDER_CREATE]: 'Place an order',
  [PERMISSIONS.ORDER_READ]: 'View own orders',
  [PERMISSIONS.ORDER_READ_ANY]: 'View any order',
  [PERMISSIONS.ORDER_UPDATE_ANY]: 'Change the status of any order',
  [PERMISSIONS.ORDER_CANCEL]: 'Cancel own order',
  [PERMISSIONS.ORDER_CANCEL_ANY]: 'Cancel any order',

  [PERMISSIONS.PAYMENT_READ_ANY]: 'View any payment',
  [PERMISSIONS.PAYMENT_REFUND]: 'Issue a refund',

  [PERMISSIONS.SHIPMENT_READ_ANY]: 'View any shipment',
  [PERMISSIONS.SHIPMENT_CREATE]: 'Create a shipment',
  [PERMISSIONS.SHIPMENT_UPDATE]: 'Update shipment status and tracking',

  [PERMISSIONS.USER_READ]: 'View user accounts',
  [PERMISSIONS.USER_WRITE]: 'Create, edit and suspend user accounts',

  [PERMISSIONS.ROLE_READ]: 'View roles and their permissions',
  [PERMISSIONS.ROLE_ASSIGN]: 'Grant and revoke roles',

  [PERMISSIONS.AUDIT_READ]: 'Read the audit log',
};

/**
 * `order:read:any` splits into resource `order`, action `read:any` — the
 * resource is always the first segment, the action is everything after it.
 */
export function splitPermission(code: PermissionCode): {
  resource: string;
  action: string;
} {
  const separator = code.indexOf(':');
  return {
    resource: code.slice(0, separator),
    action: code.slice(separator + 1),
  };
}
