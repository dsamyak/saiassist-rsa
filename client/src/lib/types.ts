// API response shapes (mirrors server/services/mappers.ts).

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  pages: number;
}

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  mobile: string | null;
  role: 'SUPER_ADMIN' | 'DEALER_ADMIN' | 'DEALER_EMPLOYEE';
  dealerId: string | null;
  mustChangePassword: boolean;
  permissions: string[];
}

export interface Session {
  user: SessionUser;
  dealer: {
    id: string;
    name: string;
    code: string;
    legalName: string | null;
    logoUrl: string | null;
    fieldRequirements: Record<'customerDob' | 'customerEmail' | 'vehicleRegistration' | 'vehicleEngine' | 'vehicleChassis', boolean>;
  } | null;
  platform: { name: string; brand: string; expiringSoonDays: number };
}

export interface DealerSettings {
  fieldRequirements: Partial<Record<'customerDob' | 'customerEmail' | 'vehicleRegistration' | 'vehicleEngine' | 'vehicleChassis', boolean>>;
  notifications: Partial<Record<'email' | 'sms' | 'whatsapp', boolean>>;
  editableSections: string[];
}

export interface Dealer {
  id: string;
  dealerCode: string;
  dealerName: string;
  legalName: string | null;
  logoFileId: string | null;
  logoUrl: string | null;
  issuerName: string | null;
  servicingOffice: string | null;
  gstin: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  rsaPhone: string | null;
  rsaEmail: string | null;
  rsaWebsite: string | null;
  policyPrefix: string | null;
  policyNumberFormat: string | null;
  dealerConditions: string | null;
  allowCustomConditions: boolean;
  settings: DealerSettings;
  status: 'ACTIVE' | 'INACTIVE';
  createdAt: string;
  updatedAt: string;
  stats?: { policies: number; active: number; revenue: number; users: number };
  users?: User[];
}

export interface User {
  id: string;
  dealerId: string | null;
  dealerName: string | null;
  name: string;
  email: string;
  mobile: string | null;
  role: SessionUser['role'];
  permissions: string[];
  status: 'ACTIVE' | 'INACTIVE';
  mustChangePassword: boolean;
  lockedUntil: string | null;
  lastLoginAt: string | null;
  createdAt: string;
}

export interface Customer {
  id: string;
  dealerId: string;
  dealerName?: string;
  name: string;
  dob: string | null;
  mobile: string;
  email: string | null;
  address: string;
  city: string;
  state: string;
  pincode: string;
  vehicleCount?: number;
  policyCount?: number;
  createdAt: string;
  updatedAt: string;
  vehicles?: Vehicle[];
}

export interface Vehicle {
  id: string;
  dealerId: string;
  customerId: string;
  customerName?: string;
  customerMobile?: string;
  registrationNo: string | null;
  vehicleType: string;
  make: string;
  model: string;
  variant: string;
  engineNo: string | null;
  chassisNo: string | null;
  fuelType: string;
  manufacturingYear: number;
  activePolicy: { id: string; policyNumber: string | null; endDate: string; status: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface Premium {
  basePremium: number;
  gstRate: number;
  gstAmount: number;
  totalPremium: number;
}

export interface Term {
  id: string;
  label: string;
  validityUnit: 'DAYS' | 'MONTHS';
  validityValue: number;
  price: number;
  status: string;
  dealerPrice?: number | null;
  effectivePrice?: number;
  premium?: Premium;
}

export interface Benefit {
  id?: string;
  name: string;
  description: string;
  isApplicable: boolean;
  applicableText: string | null;
}

export interface Product {
  id: string;
  productCode: string;
  planName: string;
  certificatePlanName: string | null;
  description: string | null;
  vehicleTypes: string[];
  fuelTypes: string[];
  maxVehicleAgeYears: number | null;
  numberOfServices: number;
  towingLimitKm: number | null;
  gstRate: number | null;
  effectiveGstRate: number;
  priceIncludesGst: boolean;
  specialConditions: string | null;
  eligibilityNotes: string | null;
  status: 'ACTIVE' | 'INACTIVE';
  sortOrder: number;
  terms: Term[];
  benefits: Benefit[];
  dealerCount?: number;
  policyCount?: number;
  eligibility?: { eligible: boolean; reasons: string[] };
}

export interface PolicyListItem {
  id: string;
  policyNumber: string | null;
  status: string;
  storedStatus: string;
  dealerId: string;
  dealerName: string;
  customerId: string;
  customerName: string;
  customerMobile: string;
  vehicleId: string;
  registrationNo: string | null;
  makeModel: string;
  chassisNo: string | null;
  engineNo: string | null;
  productId: string;
  planName: string;
  startDate: string;
  endDate: string;
  basePremium: number;
  gstAmount: number;
  totalPremium: number;
  issuedAt: string | null;
  issuedByName: string | null;
  renewedFromPolicyId: string | null;
  renewedToPolicyId: string | null;
  createdAt: string;
}

export interface Payment {
  id: string;
  dealerId: string;
  dealerName?: string;
  policyId: string;
  policyNumber?: string | null;
  policyStatus?: string;
  customerName?: string;
  amount: number;
  gstAmount: number;
  totalAmount: number;
  paymentMethod: string;
  transactionId: string | null;
  status: string;
  paidAt: string | null;
  refundAmount: number;
  refundedAt: string | null;
  refundReference: string | null;
  notes: string | null;
  createdByName?: string;
  createdAt: string;
}

export interface Cancellation {
  id: string;
  policyId: string;
  policyNumber?: string | null;
  customerName?: string;
  totalPremium?: number;
  dealerId: string;
  dealerName?: string;
  status: 'REQUESTED' | 'APPROVED' | 'REJECTED';
  reason: string;
  requestedByName: string | null;
  requestedAt: string;
  approvedByName: string | null;
  decidedAt: string | null;
  decisionNotes: string | null;
  cancellationDate: string | null;
  refundAmount: number;
  refundReference: string | null;
  paymentStatus: string | null;
}

export interface CertificateSnapshot {
  policyNumber: string | null;
  issuedAt: string | null;
  startDate: string;
  endDate: string;
  dealer: { name: string; issuerName: string; servicingOffice: string; gstin: string | null; rsaPhone: string; rsaEmail: string; rsaWebsite: string };
  customer: { name: string; dob: string | null; mobile: string; email: string | null; address: string; city: string; state: string; pincode: string };
  vehicle: {
    registrationNo: string | null;
    vehicleType: string;
    make: string;
    model: string;
    variant: string;
    engineNo: string | null;
    chassisNo: string | null;
    fuelType: string;
    manufacturingYear: number;
  };
  plan: { planName: string; certificatePlanName: string; termLabel: string; numberOfServices: number; benefits: { name: string; description: string; applicable: string }[] };
  premium: Premium;
  conditions: string;
  verifyUrl: string | null;
}

export interface PolicyDetail extends PolicyListItem {
  dealerCode: string;
  termId: string;
  termLabel: string;
  productCode: string;
  gstRate: number;
  numberOfServices: number;
  documentVersion: number;
  snapshot: CertificateSnapshot;
  createdByName: string | null;
  cancelledAt: string | null;
  renewedFrom: { id: string; policyNumber: string } | null;
  renewedTo: { id: string; policyNumber: string } | null;
  payments: Payment[];
  cancellations: Cancellation[];
  documents: { id: string; version: number; reason: string; sha256: string; sizeBytes: number; generatedAt: string; generatedByName: string | null }[];
  notifications: { id: string; channel: string; recipient: string; status: string; error: string | null; createdAt: string }[];
  actions: Record<
    | 'canDownload'
    | 'canRenew'
    | 'canCancel'
    | 'canRequestCancel'
    | 'canEndorse'
    | 'canRecordPayment'
    | 'canSuspend'
    | 'canReinstate'
    | 'canIssueDraft'
    | 'canDeleteDraft'
    | 'canNotify',
    boolean
  >;
}

export interface Quote extends Premium {
  productId: string;
  productCode: string;
  planName: string;
  certificatePlanName: string;
  termId: string;
  termLabel: string;
  startDate: string;
  endDate: string;
  startDateInput: string;
  numberOfServices: number;
  priceIncludesGst: boolean;
  benefits: Benefit[];
  warning: string | null;
}

export interface AuditEntry {
  id: number;
  dealerId: string | null;
  dealerName: string | null;
  userId: string | null;
  userName: string | null;
  userRole: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  oldValue: unknown;
  newValue: unknown;
  result: 'SUCCESS' | 'FAILURE';
  message: string | null;
  ipAddress: string | null;
  createdAt: string;
}

export interface MonthPoint {
  month: string;
  policies: number;
  total: number;
  gst?: number;
  renewals?: number;
}
