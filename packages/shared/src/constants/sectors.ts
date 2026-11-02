/**
 * Central Commercial Sector Taxonomy & Operating Invariants
 * Multi-Sector Revenue Architecture (Spec V4.2 § 3)
 *
 * Covers 8 authoritative sectors across retail, affiliate, price intelligence, and B2B services:
 * - Sector A: Gold, Silver, Bullion & Jewellery (Mandatory Priority)
 * - Sector B: Electronics & Technology
 * - Sector C: Home & Appliances
 * - Sector D: Travel & Experiences
 * - Sector E: Software & Digital Services
 * - Sector F: Office, Business & Industrial Equipment
 * - Sector G: Lifestyle & Consumer Goods
 * - Sector H: Local Services & B2B Solutions (Strictly Segregated)
 */

export type SectorCode =
  | 'SECTOR_A_PRECIOUS_METALS'
  | 'SECTOR_B_ELECTRONICS'
  | 'SECTOR_C_HOME_APPLIANCES'
  | 'SECTOR_D_TRAVEL'
  | 'SECTOR_E_SOFTWARE'
  | 'SECTOR_F_OFFICE_INDUSTRIAL'
  | 'SECTOR_G_LIFESTYLE'
  | 'SECTOR_H_LOCAL_SERVICES_B2B';

export type MonetizationModel =
  | 'AFFILIATE_COMMISSION'
  | 'MERCHANT_REFERRAL'
  | 'PRICE_INTELLIGENCE_SUBSCRIPTION'
  | 'SPONSORED_PLACEMENT'
  | 'DIRECT_B2B_PILOT';

export interface SectorDefinition {
  code: SectorCode;
  id: string;
  name: string;
  displayName: string;
  description: string;
  isConsumerDealFeed: boolean;
  isPhysicalProduct: boolean;
  monetizationModels: MonetizationModel[];
  eligibleNetworks: string[];
  subCategories: string[];
  statutoryRestrictions: string[];
  seasonalTriggers: string[];
  benchmarkDataSourceRequired?: boolean;
}

export const COMMERCIAL_SECTOR_TAXONOMY: Record<SectorCode, SectorDefinition> = {
  SECTOR_A_PRECIOUS_METALS: {
    code: 'SECTOR_A_PRECIOUS_METALS',
    id: 'gold-silver-jewellery',
    name: 'Gold, Silver, Bullion & Jewellery',
    displayName: 'Gold & Jewellery',
    description: 'Retail jewellery promotions, BIS-hallmarked gold/silver coins & bars where authorised, making-charge comparisons, and benchmark commodity price intelligence (IBJA/MCX).',
    isConsumerDealFeed: true,
    isPhysicalProduct: true,
    monetizationModels: ['AFFILIATE_COMMISSION', 'MERCHANT_REFERRAL'],
    eligibleNetworks: ['CUELINKS', 'DIRECT_MERCHANT'],
    subCategories: [
      'Gold Jewellery',
      'Silver Jewellery',
      'Gold Coins & Bars (Hallmarked)',
      'Silver Coins & Bars (Hallmarked)',
      'Retailer Festive Promotions',
      'Jewellery Brand Offers (Tanishq, CaratLane, BlueStone, Kalyan)',
      'Making-Charge & Wastage Comparisons',
      'Benchmark IBJA / MCX Price Intelligence'
    ],
    statutoryRestrictions: [
      'NO_UNVERIFIED_BENCHMARK_RATES',
      'FAIL_CLOSED_WHEN_COMMODITY_FEED_DOWN',
      'NO_COMMODITY_TRADING_RECOMMENDATIONS',
      'MANDATORY_BIS_HALLMARK_DISCLOSURE'
    ],
    seasonalTriggers: [
      'AKSHAYA_TRITIYA',
      'DHANTERAS',
      'DIWALI',
      'WEDDING_SEASON_Q4',
      'WEDDING_SEASON_Q1'
    ],
    benchmarkDataSourceRequired: true
  },
  SECTOR_B_ELECTRONICS: {
    code: 'SECTOR_B_ELECTRONICS',
    id: 'electronics-technology',
    name: 'Electronics & Technology',
    displayName: 'Electronics & Tech',
    description: 'Smartphones, laptops, tablets, monitors, audio, earbuds, smartwatches, computer peripherals, networking, chargers, and gaming tech.',
    isConsumerDealFeed: true,
    isPhysicalProduct: true,
    monetizationModels: ['AFFILIATE_COMMISSION', 'MERCHANT_REFERRAL'],
    eligibleNetworks: ['AMAZON_ASSOCIATES', 'CUELINKS', 'ADMITAD', 'EARNKARO', 'VCOMMISSION'],
    subCategories: [
      'Smartphones & Accessories',
      'Laptops & Computers',
      'Audio & Headphones',
      'Smartwatches & Wearables',
      'Monitors & Displays',
      'Computer Peripherals',
      'Networking & Connectivity',
      'Gaming Hardware',
      'Smart Home Devices'
    ],
    statutoryRestrictions: ['BIS_CRS_REGISTRATION_VERIFICATION'],
    seasonalTriggers: ['REPUBLIC_DAY_SALE', 'INDEPENDENCE_DAY_SALE', 'DIWALI_TECH_SALE', 'BACK_TO_COLLEGE']
  },
  SECTOR_C_HOME_APPLIANCES: {
    code: 'SECTOR_C_HOME_APPLIANCES',
    id: 'home-appliances',
    name: 'Home & Kitchen Appliances',
    displayName: 'Home & Appliances',
    description: 'Kitchen appliances, water purifiers, refrigerators, washing machines, air conditioners, and home improvement hardware.',
    isConsumerDealFeed: true,
    isPhysicalProduct: true,
    monetizationModels: ['AFFILIATE_COMMISSION', 'MERCHANT_REFERRAL'],
    eligibleNetworks: ['AMAZON_ASSOCIATES', 'CUELINKS', 'EARNKARO', 'VCOMMISSION'],
    subCategories: [
      'Kitchen Appliances',
      'Water Purifiers & Dispensers',
      'Refrigerators & Freezers',
      'Washing Machines & Dryers',
      'Air Conditioners & Coolers',
      'Home Automation',
      'Home Improvement & Tools'
    ],
    statutoryRestrictions: ['BEE_STAR_RATING_VERIFICATION'],
    seasonalTriggers: ['SUMMER_COOLING_SEASON', 'DIWALI_HOME_UPGRADE', 'NEW_YEAR_APPLIANCE_SALE']
  },
  SECTOR_D_TRAVEL: {
    code: 'SECTOR_D_TRAVEL',
    id: 'travel-experiences',
    name: 'Travel & Experiences',
    displayName: 'Travel & Flights',
    description: 'Domestic and international flights, hotel bookings, holiday packages, luggage, and travel promotions.',
    isConsumerDealFeed: true,
    isPhysicalProduct: false,
    monetizationModels: ['AFFILIATE_COMMISSION', 'MERCHANT_REFERRAL'],
    eligibleNetworks: ['CUELINKS', 'ADMITAD'],
    subCategories: [
      'Domestic Flight Bookings',
      'Hotel & Resort Deals',
      'Holiday Packages',
      'Luggage & Travel Gear',
      'Student Travel Discounts',
      'Transit & Railway Bookings'
    ],
    statutoryRestrictions: ['MANDATORY_TAX_AND_CONVENIENCE_FEE_DISCLOSURE'],
    seasonalTriggers: ['SUMMER_VACATION', 'PUJA_DIWALI_HOLIDAYS', 'YEAR_END_HOLIDAYS']
  },
  SECTOR_E_SOFTWARE: {
    code: 'SECTOR_E_SOFTWARE',
    id: 'software-digital-services',
    name: 'Software & Digital Services',
    displayName: 'Software & SaaS',
    description: 'Cloud accounting, GST billing, developer tools, cloud hosting, domain registration, and productivity SaaS for Indian businesses.',
    isConsumerDealFeed: true,
    isPhysicalProduct: false,
    monetizationModels: ['AFFILIATE_COMMISSION', 'MERCHANT_REFERRAL'],
    eligibleNetworks: ['DIRECT_REFERRAL', 'ADMITAD', 'VCOMMISSION', 'CUELINKS'],
    subCategories: [
      'GST Billing & Accounting SaaS',
      'Cloud Hosting & Infrastructure',
      'Developer Tools & APIs',
      'Productivity & Collaboration',
      'E-commerce Store Builders',
      'Security & VPN Services'
    ],
    statutoryRestrictions: ['GST_INVOICING_COMPLIANCE'],
    seasonalTriggers: ['FINANCIAL_YEAR_END_MARCH', 'NEW_FINANCIAL_YEAR_APRIL', 'BLACK_FRIDAY_SAAS']
  },
  SECTOR_F_OFFICE_INDUSTRIAL: {
    code: 'SECTOR_F_OFFICE_INDUSTRIAL',
    id: 'office-industrial',
    name: 'Office, Business & Industrial Equipment',
    displayName: 'Office & Industrial',
    description: 'Thermal shipping label printers, 2D barcode scanners, POS receipt printers, cash drawers, and packaging machinery for SMEs.',
    isConsumerDealFeed: true,
    isPhysicalProduct: true,
    monetizationModels: ['AFFILIATE_COMMISSION', 'MERCHANT_REFERRAL'],
    eligibleNetworks: ['AMAZON_ASSOCIATES', 'CUELINKS', 'VCOMMISSION'],
    subCategories: [
      'Direct Thermal Label Printers',
      '1D/2D Handheld & Wireless Barcode Scanners',
      'POS Receipt Printers',
      'Packaging & Shipping Supplies',
      'Digital Measuring Tools',
      'Commercial Office Hardware'
    ],
    statutoryRestrictions: ['COMMERCIAL_WARRANTY_DISCLOSURE'],
    seasonalTriggers: ['FESTIVE_DISPATCH_RUSH', 'YEAR_END_EQUIPMENT_RENEWAL']
  },
  SECTOR_G_LIFESTYLE: {
    code: 'SECTOR_G_LIFESTYLE',
    id: 'lifestyle-consumer',
    name: 'Lifestyle, Apparel & Consumer Goods',
    displayName: 'Lifestyle & Fashion',
    description: 'Branded apparel, footwear, personal care appliances, fitness equipment, and lifestyle products with genuine retailer discounts.',
    isConsumerDealFeed: true,
    isPhysicalProduct: true,
    monetizationModels: ['AFFILIATE_COMMISSION', 'MERCHANT_REFERRAL'],
    eligibleNetworks: ['CUELINKS', 'ADMITAD', 'EARNKARO'],
    subCategories: [
      'Branded Fashion & Apparel',
      'Footwear & Athletic Shoes',
      'Personal Care Appliances (Trimmers, Dryers)',
      'Eyewear & Watches',
      'Sports & Fitness Equipment',
      'Luggage & Bags'
    ],
    statutoryRestrictions: [
      'NO_UNAUTHORIZED_MEDICAL_OR_THERAPEUTIC_CLAIMS',
      'NO_PRESCRIPTION_DRUGS_OR_UNLICENSED_FORMULATIONS'
    ],
    seasonalTriggers: ['END_OF_SEASON_SALE_SUMMER', 'END_OF_SEASON_SALE_WINTER', 'FESTIVE_FASHION_POOJA_DIWALI']
  },
  SECTOR_H_LOCAL_SERVICES_B2B: {
    code: 'SECTOR_H_LOCAL_SERVICES_B2B',
    id: 'local-services-b2b',
    name: 'Local Services & B2B Solutions',
    displayName: 'Local B2B & Clinics',
    description: 'High-ticket inbound lead triage, practice management automation, and local marketing consulting for Indian service businesses (kept strictly segregated from consumer deal feeds).',
    isConsumerDealFeed: false,
    isPhysicalProduct: false,
    monetizationModels: ['DIRECT_B2B_PILOT'],
    eligibleNetworks: ['DIRECT_MERCHANT'],
    subCategories: [
      'Dental Clinics & Hospitals',
      'Specialist Healthcare Practices',
      'Education & Test Prep Coaching',
      'Real Estate Developers & Brokerages',
      'Salons & Wellness Spas',
      'B2B Professional Services'
    ],
    statutoryRestrictions: [
      'DPDP_ACT_2023_DATA_MINIMIZATION',
      'NO_AUTOMATED_COLD_OUTREACH',
      'MANDATORY_OWNER_ONE_CLICK_APPROVAL',
      'STRICT_PROPOSAL_DISCLOSURES'
    ],
    seasonalTriggers: ['NEW_ACADEMIC_YEAR', 'DIWALI_FESTIVE_CLINIC_RUSH']
  }
};

/**
 * Returns list of consumer deal sectors eligible for public discovery and publication.
 */
export function getConsumerDealSectors(): SectorDefinition[] {
  return Object.values(COMMERCIAL_SECTOR_TAXONOMY).filter(s => s.isConsumerDealFeed);
}

/**
 * Normalizes an arbitrary category string to one of the 8 authoritative sectors.
 */
export function resolveSectorFromCategory(category: string): SectorDefinition {
  const norm = (category || '').toLowerCase().trim();

  if (norm.includes('gold') || norm.includes('silver') || norm.includes('jewel') || norm.includes('bullion') || norm.includes('coin')) {
    return COMMERCIAL_SECTOR_TAXONOMY.SECTOR_A_PRECIOUS_METALS;
  }
  if (norm.includes('phone') || norm.includes('laptop') || norm.includes('audio') || norm.includes('tech') || norm.includes('electr') || norm.includes('gadget') || norm.includes('watch') || norm.includes('computer')) {
    return COMMERCIAL_SECTOR_TAXONOMY.SECTOR_B_ELECTRONICS;
  }
  if (norm.includes('home') || norm.includes('kitchen') || norm.includes('appliance') || norm.includes('purifier') || norm.includes('refriger') || norm.includes('cool')) {
    return COMMERCIAL_SECTOR_TAXONOMY.SECTOR_C_HOME_APPLIANCES;
  }
  if (norm.includes('travel') || norm.includes('flight') || norm.includes('hotel') || norm.includes('holiday') || norm.includes('tour') || norm.includes('transit')) {
    return COMMERCIAL_SECTOR_TAXONOMY.SECTOR_D_TRAVEL;
  }
  if (norm.includes('software') || norm.includes('saas') || norm.includes('cloud') || norm.includes('host') || norm.includes('gst') || norm.includes('billing')) {
    return COMMERCIAL_SECTOR_TAXONOMY.SECTOR_E_SOFTWARE;
  }
  if (norm.includes('office') || norm.includes('printer') || norm.includes('scanner') || norm.includes('barcode') || norm.includes('pos') || norm.includes('industrial') || norm.includes('tool')) {
    return COMMERCIAL_SECTOR_TAXONOMY.SECTOR_F_OFFICE_INDUSTRIAL;
  }
  if (norm.includes('fashion') || norm.includes('apparel') || norm.includes('shoe') || norm.includes('wear') || norm.includes('beauty') || norm.includes('personal') || norm.includes('lifestyle') || norm.includes('pet')) {
    return COMMERCIAL_SECTOR_TAXONOMY.SECTOR_G_LIFESTYLE;
  }
  if (norm.includes('clinic') || norm.includes('dental') || norm.includes('health') || norm.includes('coach') || norm.includes('estate') || norm.includes('b2b') || norm.includes('service')) {
    return COMMERCIAL_SECTOR_TAXONOMY.SECTOR_H_LOCAL_SERVICES_B2B;
  }

  // Default to Electronics & Tech for general merchandise
  return COMMERCIAL_SECTOR_TAXONOMY.SECTOR_B_ELECTRONICS;
}

export const COMMERCIAL_SECTORS_LIST: SectorDefinition[] = Object.values(COMMERCIAL_SECTOR_TAXONOMY);
