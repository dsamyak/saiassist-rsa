// Domain constants shared by the API server and the web client.

export const ROLES = ['SUPER_ADMIN', 'DEALER_ADMIN', 'DEALER_EMPLOYEE'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  SUPER_ADMIN: 'Super Admin',
  DEALER_ADMIN: 'Dealer Admin',
  DEALER_EMPLOYEE: 'Dealer Employee',
};

export const VEHICLE_TYPES = [
  { value: 'TWO_WHEELER', label: 'Two Wheeler' },
  { value: 'THREE_WHEELER', label: 'Three Wheeler' },
  { value: 'FOUR_WHEELER', label: 'Four Wheeler' },
  { value: 'COMMERCIAL', label: 'Commercial Vehicle' },
] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number]['value'];
export const VEHICLE_TYPE_VALUES = VEHICLE_TYPES.map((v) => v.value) as [VehicleType, ...VehicleType[]];

export const FUEL_TYPES = [
  { value: 'PETROL', label: 'Petrol' },
  { value: 'DIESEL', label: 'Diesel' },
  { value: 'CNG', label: 'CNG' },
  { value: 'LPG', label: 'LPG' },
  { value: 'ELECTRIC', label: 'Electric' },
  { value: 'HYBRID', label: 'Hybrid' },
] as const;
export type FuelType = (typeof FUEL_TYPES)[number]['value'];
export const FUEL_TYPE_VALUES = FUEL_TYPES.map((v) => v.value) as [FuelType, ...FuelType[]];

export function vehicleTypeLabel(v: string | null | undefined): string {
  return VEHICLE_TYPES.find((t) => t.value === v)?.label ?? v ?? '';
}
export function fuelTypeLabel(v: string | null | undefined): string {
  return FUEL_TYPES.find((t) => t.value === v)?.label ?? v ?? '';
}

/** Statuses stored in the database. EXPIRING_SOON / EXPIRED are derived from end_date. */
export const STORED_POLICY_STATUSES = [
  'DRAFT',
  'PAYMENT_PENDING',
  'ACTIVE',
  'CANCELLED',
  'SUSPENDED',
  'RENEWED',
] as const;
export const POLICY_STATUSES = [
  'DRAFT',
  'PAYMENT_PENDING',
  'ACTIVE',
  'EXPIRING_SOON',
  'EXPIRED',
  'CANCELLED',
  'SUSPENDED',
  'RENEWED',
] as const;
export type PolicyStatus = (typeof POLICY_STATUSES)[number];

export const POLICY_STATUS_LABELS: Record<PolicyStatus, string> = {
  DRAFT: 'Quotation / Draft',
  PAYMENT_PENDING: 'Payment Pending',
  ACTIVE: 'Active',
  EXPIRING_SOON: 'Expiring Soon',
  EXPIRED: 'Expired',
  CANCELLED: 'Cancelled',
  SUSPENDED: 'Suspended',
  RENEWED: 'Renewed',
};

export const PAYMENT_STATUSES = ['PENDING', 'SUCCESS', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  PENDING: 'Pending',
  SUCCESS: 'Success',
  FAILED: 'Failed',
  REFUNDED: 'Refunded',
  PARTIALLY_REFUNDED: 'Partially Refunded',
};

export const PAYMENT_METHODS = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'CARD', label: 'Debit / Credit Card' },
  { value: 'NET_BANKING', label: 'Net Banking' },
  { value: 'CHEQUE', label: 'Cheque / DD' },
  { value: 'DEALER_ACCOUNT', label: 'Dealer Account (Float)' },
  { value: 'OTHER', label: 'Other' },
] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]['value'];
export const PAYMENT_METHOD_VALUES = PAYMENT_METHODS.map((m) => m.value) as [PaymentMethod, ...PaymentMethod[]];
export function paymentMethodLabel(v: string | null | undefined): string {
  return PAYMENT_METHODS.find((m) => m.value === v)?.label ?? v ?? '';
}

/** Permissions a Dealer Admin can grant to Dealer Employees. Dealer Admins implicitly hold all of them. */
export const DEALER_PERMISSIONS = [
  { key: 'customers.create', label: 'Create customers', group: 'Customers & Vehicles' },
  { key: 'customers.update', label: 'Edit customers', group: 'Customers & Vehicles' },
  { key: 'vehicles.create', label: 'Add vehicles', group: 'Customers & Vehicles' },
  { key: 'vehicles.update', label: 'Edit vehicles', group: 'Customers & Vehicles' },
  { key: 'policies.quote', label: 'Create RSA quotations', group: 'RSA Policies' },
  { key: 'policies.issue', label: 'Issue RSA policies', group: 'RSA Policies' },
  { key: 'policies.view', label: 'Search & view policies', group: 'RSA Policies' },
  { key: 'policies.download', label: 'Download certificates', group: 'RSA Policies' },
  { key: 'policies.renew', label: 'Renew policies', group: 'RSA Policies' },
  { key: 'policies.cancel_request', label: 'Request cancellation', group: 'RSA Policies' },
  { key: 'policies.endorse', label: 'Endorse issued policies (limited fields)', group: 'RSA Policies' },
  { key: 'payments.view', label: 'View payment information', group: 'Payments & Reports' },
  { key: 'payments.manage', label: 'Record / update payments', group: 'Payments & Reports' },
  { key: 'reports.view', label: 'View dealer reports', group: 'Payments & Reports' },
] as const;
export type DealerPermission = (typeof DEALER_PERMISSIONS)[number]['key'];
export const DEALER_PERMISSION_KEYS = DEALER_PERMISSIONS.map((p) => p.key) as [DealerPermission, ...DealerPermission[]];

/** Permissions only a Dealer Admin (never an employee) holds inside a dealer workspace. */
export const DEALER_ADMIN_ONLY_PERMISSIONS = [
  'employees.manage',
  'settings.manage',
  'policies.cancel',
  'audit.view',
] as const;

/** Dealer-workspace permissions a Super Admin holds when viewing dealer data. */
export const SUPER_ADMIN_DEALER_PERMISSIONS = [
  'policies.view',
  'policies.download',
  'policies.cancel',
  'payments.view',
  'reports.view',
  'audit.view',
] as const;

export type Permission = DealerPermission | (typeof DEALER_ADMIN_ONLY_PERMISSIONS)[number];

export const DEFAULT_EMPLOYEE_PERMISSIONS: DealerPermission[] = [
  'customers.create',
  'customers.update',
  'vehicles.create',
  'policies.quote',
  'policies.issue',
  'policies.view',
  'policies.download',
  'policies.renew',
  'payments.view',
];

/** Dealer settings sections a Super Admin can allow a Dealer Admin to edit. */
export const DEALER_EDITABLE_SECTIONS = [
  { key: 'logo', label: 'Logo' },
  { key: 'contact', label: 'Dealer contact details (address, phone, email, website)' },
  { key: 'rsaContact', label: 'RSA helpline shown on certificates' },
  { key: 'conditions', label: 'Dealer-specific special conditions' },
  { key: 'notifications', label: 'Customer notification preferences' },
] as const;
export type DealerEditableSection = (typeof DEALER_EDITABLE_SECTIONS)[number]['key'];

export const VALIDITY_UNITS = ['DAYS', 'MONTHS'] as const;

export const INDIAN_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana',
  'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur',
  'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana',
  'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh',
  'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

export const VEHICLE_MAKES = [
  'Honda', 'Hero', 'Bajaj', 'TVS', 'Royal Enfield', 'Suzuki', 'Yamaha', 'KTM', 'Ather', 'Ola Electric',
  'Maruti Suzuki', 'Hyundai', 'Tata', 'Mahindra', 'Kia', 'Toyota', 'Renault', 'Skoda', 'Volkswagen', 'MG',
  'Piaggio', 'Ashok Leyland', 'Eicher',
];

export const AUDIT_ACTION_LABELS: Record<string, string> = {
  LOGIN: 'Login',
  LOGIN_FAILED: 'Login failed',
  LOGOUT: 'Logout',
  PASSWORD_CHANGED: 'Password changed',
  CUSTOMER_CREATED: 'Customer created',
  CUSTOMER_UPDATED: 'Customer updated',
  VEHICLE_CREATED: 'Vehicle created',
  VEHICLE_UPDATED: 'Vehicle updated',
  POLICY_DRAFT_SAVED: 'Quotation saved',
  POLICY_DRAFT_DELETED: 'Quotation deleted',
  POLICY_CREATED: 'Policy created',
  POLICY_ISSUED: 'RSA policy issued',
  POLICY_ACTIVATED: 'Policy activated',
  POLICY_RENEWED: 'Policy renewed',
  POLICY_ENDORSED: 'Policy endorsed',
  POLICY_CANCELLED: 'Policy cancelled',
  POLICY_SUSPENDED: 'Policy suspended',
  POLICY_REINSTATED: 'Policy reinstated',
  CANCELLATION_REQUESTED: 'Cancellation requested',
  CANCELLATION_REJECTED: 'Cancellation rejected',
  CERTIFICATE_GENERATED: 'Certificate generated',
  CERTIFICATE_DOWNLOADED: 'Certificate downloaded',
  PAYMENT_RECORDED: 'Payment recorded',
  PAYMENT_UPDATED: 'Payment updated',
  PAYMENT_REFUNDED: 'Payment refunded',
  PRODUCT_CREATED: 'Product created',
  PRODUCT_UPDATED: 'Product updated',
  DEALER_CREATED: 'Dealer created',
  DEALER_UPDATED: 'Dealer updated',
  DEALER_STATUS_CHANGED: 'Dealer status changed',
  DEALER_PRODUCTS_UPDATED: 'Dealer products / pricing updated',
  DEALER_SETTINGS_UPDATED: 'Dealer settings updated',
  USER_CREATED: 'User created',
  USER_UPDATED: 'User updated',
  USER_PASSWORD_RESET: 'User password reset',
  SETTINGS_UPDATED: 'Platform settings updated',
  NOTIFICATION_SENT: 'Notification sent',
};
