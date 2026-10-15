import { fileUrl } from './files';
import { parseDealerSettings } from './settings';

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : (v as string | null) ?? null);

export function toDealer(r: any) {
  return {
    id: r.id,
    dealerCode: r.dealer_code,
    dealerName: r.dealer_name,
    legalName: r.legal_name,
    logoFileId: r.logo_file_id,
    logoUrl: fileUrl(r.logo_file_id),
    issuerName: r.issuer_name,
    servicingOffice: r.servicing_office,
    gstin: r.gstin,
    address: r.address,
    city: r.city,
    state: r.state,
    pincode: r.pincode,
    phone: r.phone,
    email: r.email,
    website: r.website,
    rsaPhone: r.rsa_phone,
    rsaEmail: r.rsa_email,
    rsaWebsite: r.rsa_website,
    policyPrefix: r.policy_prefix,
    policyNumberFormat: r.policy_number_format,
    dealerConditions: r.dealer_conditions,
    allowCustomConditions: r.allow_custom_conditions,
    settings: parseDealerSettings(r.settings),
    status: r.status,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export function toUser(r: any) {
  return {
    id: r.id,
    dealerId: r.dealer_id,
    dealerName: r.dealer_name ?? null,
    name: r.name,
    email: r.email,
    mobile: r.mobile,
    role: r.role,
    permissions: r.permissions ?? [],
    status: r.status,
    mustChangePassword: r.must_change_password,
    lockedUntil: iso(r.locked_until),
    lastLoginAt: iso(r.last_login_at),
    createdAt: iso(r.created_at),
  };
}

export function toCustomer(r: any) {
  return {
    id: r.id,
    dealerId: r.dealer_id,
    dealerName: r.dealer_name ?? undefined,
    name: r.name,
    dob: r.dob,
    mobile: r.mobile,
    email: r.email,
    address: r.address,
    city: r.city,
    state: r.state,
    pincode: r.pincode,
    vehicleCount: r.vehicle_count ?? undefined,
    policyCount: r.policy_count ?? undefined,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export function toVehicle(r: any) {
  return {
    id: r.id,
    dealerId: r.dealer_id,
    customerId: r.customer_id,
    customerName: r.customer_name ?? undefined,
    customerMobile: r.customer_mobile ?? undefined,
    registrationNo: r.registration_no,
    vehicleType: r.vehicle_type,
    make: r.make,
    model: r.model,
    variant: r.variant,
    engineNo: r.engine_no,
    chassisNo: r.chassis_no,
    fuelType: r.fuel_type,
    manufacturingYear: r.manufacturing_year,
    activePolicy: r.active_policy_id
      ? { id: r.active_policy_id, policyNumber: r.active_policy_number, endDate: iso(r.active_policy_end), status: r.active_policy_status }
      : null,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export function toPolicyListItem(r: any) {
  return {
    id: r.id,
    policyNumber: r.policy_number,
    status: r.effective_status ?? r.status,
    storedStatus: r.status,
    dealerId: r.dealer_id,
    dealerName: r.dealer_name,
    customerId: r.customer_id,
    customerName: r.customer_name,
    customerMobile: r.customer_mobile,
    vehicleId: r.vehicle_id,
    registrationNo: r.registration_no,
    makeModel: [r.make, r.model].filter(Boolean).join(' '),
    chassisNo: r.chassis_no,
    engineNo: r.engine_no,
    productId: r.product_id,
    planName: r.plan_name,
    startDate: iso(r.start_date),
    endDate: iso(r.end_date),
    basePremium: r.base_premium,
    gstAmount: r.gst_amount,
    totalPremium: r.total_premium,
    issuedAt: iso(r.issued_at),
    issuedByName: r.issued_by_name ?? null,
    renewedFromPolicyId: r.renewed_from_policy_id,
    renewedToPolicyId: r.renewed_to_policy_id,
    createdAt: iso(r.created_at),
  };
}

export function toPayment(r: any) {
  return {
    id: r.id,
    dealerId: r.dealer_id,
    dealerName: r.dealer_name ?? undefined,
    policyId: r.policy_id,
    policyNumber: r.policy_number ?? undefined,
    policyStatus: r.policy_status ?? undefined,
    customerName: r.customer_name ?? undefined,
    amount: r.amount,
    gstAmount: r.gst_amount,
    totalAmount: r.total_amount,
    paymentMethod: r.payment_method,
    transactionId: r.transaction_id,
    status: r.status,
    paidAt: iso(r.paid_at),
    refundAmount: r.refund_amount,
    refundedAt: iso(r.refunded_at),
    refundReference: r.refund_reference,
    notes: r.notes,
    createdByName: r.created_by_name ?? undefined,
    createdAt: iso(r.created_at),
  };
}

export function toCancellation(r: any) {
  return {
    id: r.id,
    policyId: r.policy_id,
    policyNumber: r.policy_number ?? undefined,
    customerName: r.customer_name ?? undefined,
    totalPremium: r.total_premium ?? undefined,
    dealerId: r.dealer_id,
    dealerName: r.dealer_name ?? undefined,
    status: r.status,
    reason: r.reason,
    requestedByName: r.requested_by_name ?? null,
    requestedAt: iso(r.requested_at),
    approvedByName: r.approved_by_name ?? null,
    decidedAt: iso(r.decided_at),
    decisionNotes: r.decision_notes,
    cancellationDate: iso(r.cancellation_date),
    refundAmount: r.refund_amount,
    refundReference: r.refund_reference,
    paymentStatus: r.payment_status,
  };
}

export function toAudit(r: any) {
  return {
    id: r.id,
    dealerId: r.dealer_id,
    dealerName: r.dealer_name ?? null,
    userId: r.user_id,
    userName: r.user_name,
    userRole: r.user_role,
    action: r.action,
    entityType: r.entity_type,
    entityId: r.entity_id,
    entityLabel: r.entity_label,
    oldValue: r.old_value,
    newValue: r.new_value,
    result: r.result,
    message: r.message,
    ipAddress: r.ip_address,
    createdAt: iso(r.created_at),
  };
}

export const paginate = <T>(items: T[], total: number, page: number, pageSize: number) => ({
  items,
  total,
  page,
  pageSize,
  pages: Math.max(1, Math.ceil(total / pageSize)),
});
