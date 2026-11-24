import { ROLES } from "./roles";

/**
 * Every permission the system knows about, taken from the screen-by-screen
 * permissions matrix in the requirements doc (section 5).
 *
 * Naming: `<area>.<action>`. Where the matrix gives a role a narrower view
 * of the same screen, the permission carries a scope suffix:
 *   .assigned - only records assigned to the user (staff)
 *   .own      - only the user's own records (client portal)
 *
 * Several areas (CRM, logistics, invoices) have no endpoints yet. Their
 * permissions are defined now so roles can be configured once and the
 * frontend can rely on one list.
 */
export const PERMISSIONS = [
  // Dashboards
  { name: "dashboard.view", group: "Dashboards", description: "View the admin dashboard (limited to assigned data for staff)" },
  { name: "dashboard.system", group: "Dashboards", description: "View the super admin system dashboard" },

  // Users, roles and settings
  { name: "users.view", group: "Users", description: "View users" },
  { name: "users.create", group: "Users", description: "Create users" },
  { name: "users.update", group: "Users", description: "Edit users" },
  { name: "users.manage_status", group: "Users", description: "Activate or deactivate users" },
  { name: "users.delete", group: "Users", description: "Archive (soft delete) users" },
  { name: "users.delete_permanent", group: "Users", description: "Permanently delete users" },
  { name: "roles.view", group: "Users", description: "View roles" },
  { name: "roles.manage", group: "Users", description: "Change role permissions" },
  { name: "settings.business", group: "Settings", description: "Manage business settings" },
  { name: "settings.system", group: "Settings", description: "Manage global system settings" },

  // CRM
  { name: "crm.contacts.view", group: "CRM", description: "View all contacts and companies" },
  { name: "crm.contacts.view.assigned", group: "CRM", description: "View assigned contacts" },
  { name: "crm.contacts.view.own", group: "CRM", description: "View own contact record and communication" },
  { name: "crm.contacts.manage", group: "CRM", description: "Create and edit any contact" },
  { name: "crm.contacts.manage.assigned", group: "CRM", description: "Edit notes and tasks on assigned contacts" },
  { name: "crm.leads.view", group: "CRM", description: "View all leads" },
  { name: "crm.leads.view.assigned", group: "CRM", description: "View assigned leads" },
  { name: "crm.leads.manage", group: "CRM", description: "Create and edit any lead" },
  { name: "crm.leads.manage.assigned", group: "CRM", description: "Update assigned leads" },
  { name: "crm.deals.manage", group: "CRM", description: "Create, edit and move any deal" },
  { name: "crm.deals.move.assigned", group: "CRM", description: "Move assigned deals through the pipeline" },
  { name: "crm.reports.view", group: "CRM", description: "View all CRM reports" },
  { name: "crm.reports.view.team", group: "CRM", description: "View team CRM reports" },

  // Inventory
  { name: "products.view", group: "Inventory", description: "View products" },
  { name: "products.create", group: "Inventory", description: "Create products (including by scanning a new barcode)" },
  { name: "products.update", group: "Inventory", description: "Edit products" },
  { name: "products.delete", group: "Inventory", description: "Archive products" },
  { name: "warehouses.view", group: "Inventory", description: "View warehouses" },
  { name: "warehouses.create", group: "Inventory", description: "Create warehouses" },
  { name: "warehouses.update", group: "Inventory", description: "Edit warehouses" },
  { name: "warehouses.delete", group: "Inventory", description: "Deactivate warehouses" },
  { name: "items.view", group: "Inventory", description: "View stock items" },
  { name: "items.create", group: "Inventory", description: "Receive stock items" },
  { name: "items.update", group: "Inventory", description: "Edit item details and move items between warehouses" },
  { name: "items.update_price", group: "Inventory", description: "Change item prices" },
  { name: "items.change_status", group: "Inventory", description: "Sell, remove and return items" },
  { name: "stock_adjustments.submit", group: "Inventory", description: "Submit stock adjustments" },
  { name: "stock_adjustments.approve", group: "Inventory", description: "Approve stock adjustments" },
  { name: "low_stock.view", group: "Inventory", description: "View low-stock alerts" },
  { name: "low_stock.manage", group: "Inventory", description: "Change reorder thresholds" },
  { name: "inventory_reports.view", group: "Inventory", description: "View and export stock valuation reports" },

  // Logistics
  { name: "shipments.view", group: "Logistics", description: "View all shipments" },
  { name: "shipments.view.assigned", group: "Logistics", description: "View assigned shipments" },
  { name: "shipments.view.own", group: "Logistics", description: "View own shipment status and tracking" },
  { name: "shipments.create", group: "Logistics", description: "Create shipments" },
  { name: "shipments.manage", group: "Logistics", description: "Edit any shipment" },
  { name: "shipments.update_status", group: "Logistics", description: "Update shipment status and notes" },
  { name: "fulfilment.view", group: "Logistics", description: "View the fulfilment board" },
  { name: "fulfilment.move", group: "Logistics", description: "Move shipments through fulfilment statuses" },
  { name: "shipment_reports.view", group: "Logistics", description: "View and export shipment reports" },
  { name: "shipment_reports.view.team", group: "Logistics", description: "View team shipment reports" },

  // ERP: invoices and accounts
  { name: "invoices.view", group: "ERP", description: "View all invoices" },
  { name: "invoices.view.limited", group: "ERP", description: "View invoices without financial editing" },
  { name: "invoices.view.own", group: "ERP", description: "View and download own invoices" },
  { name: "invoices.manage", group: "ERP", description: "Create, edit and send invoices" },
  { name: "invoices.mark_paid", group: "ERP", description: "Mark invoices as paid" },
  { name: "invoices.delete", group: "ERP", description: "Delete invoices" },
  { name: "accounts.view", group: "ERP", description: "View all account balances" },
  { name: "accounts.view.own", group: "ERP", description: "View own account" },
  { name: "erp_reports.view", group: "ERP", description: "View and export ERP reports" },

  // Client portal
  { name: "support.create.own", group: "Client portal", description: "Submit inquiries and support messages" },
] as const;

export type PermissionName = (typeof PERMISSIONS)[number]["name"];

export const PERMISSION_NAMES: readonly PermissionName[] = PERMISSIONS.map((p) => p.name);

/**
 * Only super admins may ever hold these. The role-permissions endpoint
 * refuses to grant them to any other role.
 */
export const SUPER_ADMIN_ONLY_PERMISSIONS: readonly PermissionName[] = [
  "dashboard.system",
  "users.delete_permanent",
  "roles.manage",
  "settings.system",
];

const SCOPED = /\.(assigned|own|team|limited)$/;

/**
 * Default mapping applied by the seed. Super admin always has every
 * permission (enforced in code, not just in the database).
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<string, readonly PermissionName[]> = {
  [ROLES.SUPER_ADMIN]: PERMISSION_NAMES,

  // Everything except super-admin-only permissions; admins see all
  // records, so the scoped variants aren't needed.
  [ROLES.ADMIN]: PERMISSION_NAMES.filter(
    (name) => !SUPER_ADMIN_ONLY_PERMISSIONS.includes(name) && !SCOPED.test(name)
  ),

  [ROLES.STAFF]: [
    "dashboard.view",
    "crm.contacts.view.assigned",
    "crm.contacts.manage.assigned",
    "crm.leads.view.assigned",
    "crm.leads.manage.assigned",
    "crm.deals.move.assigned",
    "crm.reports.view.team",
    "products.view",
    "warehouses.view",
    "items.view",
    "items.create",
    "items.update",
    "items.change_status",
    "stock_adjustments.submit",
    "low_stock.view",
    "shipments.view.assigned",
    "shipments.create",
    "shipments.update_status",
    "fulfilment.view",
    "fulfilment.move",
    "shipment_reports.view.team",
    "invoices.view.limited",
  ],

  [ROLES.CLIENT]: [
    "crm.contacts.view.own",
    "shipments.view.own",
    "invoices.view.own",
    "accounts.view.own",
    "support.create.own",
  ],
};
