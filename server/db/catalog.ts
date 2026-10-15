// Default RSA catalogue seeded on first start. Everything here is editable by the Super Admin.

export interface CatalogBenefit {
  name: string;
  description: string;
  applicable?: string;
}

export interface CatalogProduct {
  code: string;
  planName: string;
  certificatePlanName: string;
  description: string;
  vehicleTypes: string[];
  fuelTypes: string[];
  maxVehicleAgeYears: number | null;
  numberOfServices: number;
  towingLimitKm: number | null;
  priceIncludesGst: boolean;
  specialConditions: string | null;
  terms: { label: string; unit: 'DAYS' | 'MONTHS'; value: number; price: number }[];
  benefits: CatalogBenefit[];
}

const towing = (km: number): CatalogBenefit => ({
  name: 'Towing Assistance',
  description: `To and fro up to ${km} kms from the breakdown spot (one towing)*`,
});

export const STANDARD_BENEFITS: CatalogBenefit[] = [
  { name: 'Battery Check Up & Jump Start', description: 'A Technician to be arranged for Jumpstart' },
  {
    name: 'Flat Tyre',
    description:
      'Arrange For a Technician to Repair the Puncture Tyre. The Cost of Puncture repair and all incidental charges to be borne by Customer on actual basis',
  },
  {
    name: 'Fuel Arrangement Assistance*',
    description: 'Arrange For a Fuel Delivery in Case Vehicle Is Out of Fuel. Fuel Cost on actual basis payable by Customer',
  },
  { name: 'Relay of Urgent Messages', description: "Pass On Message to Rider's Friends & Family" },
  { name: 'Vehicle Breakdown Phone Support', description: 'Guiding The Rider On Phone about Vehicle Related Problem' },
];

export const DEFAULT_PRODUCTS: CatalogProduct[] = [
  {
    code: 'TW-BASIC',
    planName: 'Two Wheeler RSA - Basic',
    certificatePlanName: 'RSA Basic',
    description: 'Essential roadside assistance for motorcycles and scooters with one service during the plan.',
    vehicleTypes: ['TWO_WHEELER'],
    fuelTypes: [],
    maxVehicleAgeYears: 10,
    numberOfServices: 1,
    towingLimitKm: 15,
    priceIncludesGst: true,
    specialConditions: null,
    terms: [{ label: '1 Year', unit: 'MONTHS', value: 12, price: 1000 }],
    benefits: [...STANDARD_BENEFITS, towing(15)],
  },
  {
    code: 'TW-STD',
    planName: 'Two Wheeler RSA - Standard',
    certificatePlanName: 'RSA Standard',
    description: 'Extended two wheeler cover with two services and longer towing distance.',
    vehicleTypes: ['TWO_WHEELER'],
    fuelTypes: [],
    maxVehicleAgeYears: 10,
    numberOfServices: 2,
    towingLimitKm: 25,
    priceIncludesGst: true,
    specialConditions: null,
    terms: [
      { label: '1 Year', unit: 'MONTHS', value: 12, price: 1500 },
      { label: '2 Years', unit: 'MONTHS', value: 24, price: 2700 },
    ],
    benefits: [...STANDARD_BENEFITS, towing(25)],
  },
  {
    code: 'FW-STD',
    planName: 'Four Wheeler RSA - Standard',
    certificatePlanName: 'RSA Car Standard',
    description: 'Roadside assistance for cars with two services per plan.',
    vehicleTypes: ['FOUR_WHEELER'],
    fuelTypes: [],
    maxVehicleAgeYears: 12,
    numberOfServices: 2,
    towingLimitKm: 50,
    priceIncludesGst: true,
    specialConditions: null,
    terms: [{ label: '1 Year', unit: 'MONTHS', value: 12, price: 2500 }],
    benefits: [
      ...STANDARD_BENEFITS,
      { name: 'Key Lock-out Assistance', description: 'Arrange a technician to assist when keys are locked inside the vehicle' },
      towing(50),
    ],
  },
  {
    code: 'FW-PREM',
    planName: 'Four Wheeler RSA - Premium',
    certificatePlanName: 'RSA Car Premium',
    description: 'Premium car cover with four services, long distance towing and stay/travel assistance.',
    vehicleTypes: ['FOUR_WHEELER'],
    fuelTypes: [],
    maxVehicleAgeYears: 8,
    numberOfServices: 4,
    towingLimitKm: 100,
    priceIncludesGst: true,
    specialConditions: 'Accommodation and taxi assistance are arranged on a best-effort basis; actual costs are payable by the Certificate holder.',
    terms: [
      { label: '1 Year', unit: 'MONTHS', value: 12, price: 4000 },
      { label: '3 Years', unit: 'MONTHS', value: 36, price: 10000 },
    ],
    benefits: [
      ...STANDARD_BENEFITS,
      { name: 'Key Lock-out Assistance', description: 'Arrange a technician to assist when keys are locked inside the vehicle' },
      { name: 'Accommodation Assistance', description: 'Help locate and book a hotel near the breakdown location' },
      { name: 'Taxi Assistance', description: 'Arrange an alternate cab to continue the journey' },
      towing(100),
    ],
  },
  {
    code: 'EV-RSA',
    planName: 'EV RSA',
    certificatePlanName: 'RSA EV Care',
    description: 'Roadside assistance designed for electric two and four wheelers.',
    vehicleTypes: ['TWO_WHEELER', 'FOUR_WHEELER'],
    fuelTypes: ['ELECTRIC'],
    maxVehicleAgeYears: 8,
    numberOfServices: 2,
    towingLimitKm: 40,
    priceIncludesGst: true,
    specialConditions: 'Charging assistance is subject to availability of mobile charging units in the area.',
    terms: [{ label: '1 Year', unit: 'MONTHS', value: 12, price: 1800 }],
    benefits: [
      { name: 'Mobile Charging Assistance', description: 'Arrange a mobile charging unit or tow to the nearest charging station' },
      {
        name: 'Flat Tyre',
        description: 'Arrange For a Technician to Repair the Puncture Tyre. Cost of repair payable by Customer on actual basis',
      },
      { name: 'Relay of Urgent Messages', description: "Pass On Message to Rider's Friends & Family" },
      { name: 'Vehicle Breakdown Phone Support', description: 'Guiding The Rider On Phone about Vehicle Related Problem' },
      towing(40),
    ],
  },
  {
    code: 'THW-STD',
    planName: 'Three Wheeler RSA',
    certificatePlanName: 'RSA Three Wheeler',
    description: 'Roadside assistance for auto-rickshaws and small three wheeler carriers.',
    vehicleTypes: ['THREE_WHEELER'],
    fuelTypes: [],
    maxVehicleAgeYears: 10,
    numberOfServices: 2,
    towingLimitKm: 25,
    priceIncludesGst: false,
    specialConditions: null,
    terms: [{ label: '1 Year', unit: 'MONTHS', value: 12, price: 1200 }],
    benefits: [...STANDARD_BENEFITS, towing(25)],
  },
];
