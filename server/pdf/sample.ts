import type { CertificateSnapshot } from './certificate';
import { coveragePeriod } from '../lib/dates';
import { calculatePremium } from '../lib/money';
import { DEFAULT_PRODUCTS } from '../db/catalog';
import type { PlatformSettings } from '../services/settings';

/** Fictional data used for template previews. */
export function sampleSnapshot(settings: PlatformSettings, dealer?: Partial<CertificateSnapshot['dealer']>): CertificateSnapshot {
  const product = DEFAULT_PRODUCTS[0];
  const { start, end } = coveragePeriod('2026-10-14', 'MONTHS', 12);
  return {
    version: 1,
    platformName: settings.platformName,
    policyNumber: 'SA2026101400001',
    issuedAt: start.toISOString(),
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    dealer: {
      id: 'sample',
      code: 'SAMPLE',
      name: 'Sample Motors',
      legalName: 'Sample Motors Private Limited',
      logoFileId: null,
      issuerName: settings.defaultIssuerName.toUpperCase(),
      servicingOffice: settings.defaultServicingOffice,
      gstin: '27ABCDE1234F1Z5',
      rsaPhone: settings.rsaPhone,
      rsaEmail: settings.rsaEmail,
      rsaWebsite: settings.rsaWebsite,
      ...dealer,
    },
    customer: {
      name: 'RAHUL SHARAD PATIL',
      dob: '1994-11-18',
      mobile: '9876543210',
      email: 'rahul.patil@example.com',
      address: 'Flat 12, Shivaji Nagar, Near Main Road, Ward No. 2',
      city: 'Kolhapur',
      state: 'Maharashtra',
      pincode: '416001',
    },
    vehicle: {
      registrationNo: null,
      vehicleType: 'TWO_WHEELER',
      make: 'HONDA',
      model: 'SP125',
      variant: 'DLX DRUM BRAKE ALLOY WHEEL OBD2B',
      engineNo: 'JC94EG1234567',
      chassisNo: 'ME4JC94FHTG123456',
      fuelType: 'PETROL',
      manufacturingYear: 2026,
    },
    plan: {
      productId: 'sample',
      productCode: product.code,
      planName: product.planName,
      certificatePlanName: settings.rsaBrandName,
      termLabel: product.terms[0].label,
      numberOfServices: product.numberOfServices,
      benefits: product.benefits.map((b) => ({ name: b.name, description: b.description, applicable: b.applicable ?? 'Yes' })),
    },
    premium: calculatePremium(product.terms[0].price, product.priceIncludesGst, settings.defaultGstRate),
    conditions: settings.standardConditions,
    template: settings.certificate,
    verifyUrl: 'https://rsa.example.com/verify/SA2026101400001',
  };
}
