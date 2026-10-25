/**
 * Isolated unit-test sample deal fixtures (Spec § 2, 4, 5).
 * Explicitly labeled as test fixtures — NEVER hardcoded in production paths.
 */

import { DiscoveredDealInput } from '../../src/commission/deal-types.js';

export const SAMPLE_DEAL_CANDIDATES_FIXTURE: DiscoveredDealInput[] = [
  {
    title: 'boAt Airdopes 141 Bluetooth Truly Wireless in Ear Earbuds',
    brand: 'boAt',
    merchant: 'boAt Lifestyle',
    category: 'Audio & Wearables',
    productUrl: 'https://www.boat-lifestyle.com/products/airdopes-141',
    currentPriceINR: 1299,
    referencePriceINR: 4490,
    claimedDiscountPercent: 71,
    couponCode: 'BOATEXTRA10',
    couponConditions: 'Extra 10% off on prepaid orders above ₹999',
    availability: 'IN_STOCK',
    geographicRestrictions: ['India'],
    offerStart: new Date(Date.now() - 86400000).toISOString(),
    expiryDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    sourceUrl: 'https://www.boat-lifestyle.com/collections/best-deals',
    sourceDomain: 'boat-lifestyle.com',
    sourceType: 'RETAILER_BRAND',
    modelOrSku: 'AIRDOPES-141-BLK'
  },
  {
    title: 'Noise ColorFit Pulse 2 Max 1.85" Display Bluetooth Calling Smart Watch',
    brand: 'Noise',
    merchant: 'Noise India',
    category: 'Audio & Wearables',
    productUrl: 'https://www.gonoise.com/products/colorfit-pulse-2-max-smartwatch',
    currentPriceINR: 1499,
    referencePriceINR: 5999,
    claimedDiscountPercent: 75,
    couponCode: 'NOISEPULSE',
    couponConditions: 'Flat ₹100 instant discount on UPI checkout',
    availability: 'IN_STOCK',
    geographicRestrictions: ['India'],
    offerStart: new Date(Date.now() - 172800000).toISOString(),
    expiryDate: new Date(Date.now() + 5 * 86400000).toISOString(),
    sourceUrl: 'https://www.gonoise.com/collections/smart-watches',
    sourceDomain: 'gonoise.com',
    sourceType: 'RETAILER_BRAND',
    modelOrSku: 'NOISE-PULSE2-MAX'
  },
  {
    title: 'Lenovo IdeaPad Slim 3 12th Gen Intel Core i3 15.6" FHD Laptop (8GB/512GB SSD)',
    brand: 'Lenovo',
    merchant: 'Lenovo India',
    category: 'Computers & Laptops',
    productUrl: 'https://www.lenovo.com/in/en/laptops/ideapad/ideapad-3-series/ideapad-slim-3-gen-7-15-intel',
    currentPriceINR: 35990,
    referencePriceINR: 52990,
    claimedDiscountPercent: 32,
    couponCode: 'LENOVOOFFICE',
    couponConditions: 'Free wireless mouse & bag included',
    availability: 'IN_STOCK',
    geographicRestrictions: ['India'],
    offerStart: new Date(Date.now() - 86400000).toISOString(),
    expiryDate: new Date(Date.now() + 10 * 86400000).toISOString(),
    sourceUrl: 'https://www.lenovo.com/in/en/d/deals/laptops',
    sourceDomain: 'lenovo.com',
    sourceType: 'RETAILER_BRAND',
    modelOrSku: '82RK0085IN'
  },
  {
    title: 'Croma 10000 mAh 22.5W Fast Charging Power Bank (Type C & Micro USB)',
    brand: 'Croma',
    merchant: 'Croma India',
    category: 'Electronics & Peripherals',
    productUrl: 'https://www.croma.com/croma-10000mah-22-5w-fast-charging-power-bank/p/264582',
    currentPriceINR: 899,
    referencePriceINR: 1900,
    claimedDiscountPercent: 53,
    availability: 'IN_STOCK',
    geographicRestrictions: ['India'],
    sourceUrl: 'https://www.croma.com/deals-of-the-day',
    sourceDomain: 'croma.com',
    sourceType: 'RETAILER_BRAND',
    modelOrSku: 'CRSP10K22W'
  },
  {
    title: 'Philips Air Fryer HD9200/90 with Rapid Air Technology (4.1 Liter)',
    brand: 'Philips',
    merchant: 'Reliance Digital',
    category: 'Electronics & Appliances',
    productUrl: 'https://www.reliancedigital.in/philips-hd9200-90-air-fryer/p/492403612',
    currentPriceINR: 6499,
    referencePriceINR: 9995,
    claimedDiscountPercent: 35,
    couponCode: 'KITCHEN500',
    couponConditions: 'Instant ₹500 off on major bank debit/credit cards',
    availability: 'IN_STOCK',
    geographicRestrictions: ['India'],
    sourceUrl: 'https://www.reliancedigital.in/kitchen-appliances-fest',
    sourceDomain: 'reliancedigital.in',
    sourceType: 'RETAILER_BRAND',
    modelOrSku: 'HD9200-90'
  },
  {
    title: 'Zoho Workplace Standard Suite (Cloud Email, Docs, Sheets, Chat & Storage)',
    brand: 'Zoho',
    merchant: 'Zoho India',
    category: 'SaaS & Business Software',
    productUrl: 'https://www.zoho.com/workplace/pricing.html',
    currentPriceINR: 99,
    referencePriceINR: 149,
    claimedDiscountPercent: 34,
    couponConditions: 'Per user per month billed annually with free Indian domain support',
    availability: 'IN_STOCK',
    geographicRestrictions: ['India'],
    sourceUrl: 'https://www.zoho.com/workplace/',
    sourceDomain: 'zoho.com',
    sourceType: 'RETAILER_BRAND',
    modelOrSku: 'ZOHO-WP-STD-IN'
  },
  {
    title: 'Logitech M221 Silent Wireless Optical Mouse with 2.4GHz USB Nano Receiver',
    brand: 'Logitech',
    merchant: 'Vijay Sales',
    category: 'Electronics & Peripherals',
    productUrl: 'https://www.vijaysales.com/logitech-m221-silent-wireless-mouse/p/16278',
    currentPriceINR: 699,
    referencePriceINR: 1295,
    claimedDiscountPercent: 46,
    availability: 'IN_STOCK',
    geographicRestrictions: ['India'],
    sourceUrl: 'https://www.desidime.com/deals/logitech-m221-wireless-silent-mouse',
    sourceDomain: 'desidime.com',
    sourceType: 'PUBLIC_DEAL_FEED',
    modelOrSku: 'LOGI-M221-BLK'
  }
];

export const SAMPLE_COUPON_CANDIDATES_FIXTURE: DiscoveredDealInput[] = [
  {
    title: 'Swiggy Gourmet Feast Coupon - Flat 50% Off',
    brand: 'Swiggy',
    merchant: 'Swiggy India',
    category: 'Food & Dining',
    productUrl: 'https://www.swiggy.com/restaurants',
    dealKind: 'COUPON',
    couponCode: 'FEAST50',
    couponConditions: 'Flat 50% off up to ₹150 on min order ₹299',
    availability: 'IN_STOCK',
    geographicRestrictions: ['India'],
    offerStart: new Date(Date.now() - 86400000).toISOString(),
    expiryDate: new Date(Date.now() + 7 * 86400000).toISOString(),
    sourceUrl: 'https://www.desidime.com/coupons/swiggy-feast-50',
    sourceDomain: 'desidime.com',
    sourceType: 'PUBLIC_DEAL_FEED'
  },
  {
    title: 'Ajio All Stars Sale Coupon - Flat ₹500 Off',
    brand: 'Ajio',
    merchant: 'Ajio India',
    category: 'Fashion & Lifestyle',
    productUrl: 'https://www.ajio.com/c/all-stars-sale',
    dealKind: 'COUPON',
    couponCode: 'ALLSTAR500',
    couponConditions: 'Flat ₹500 off on minimum order value ₹1990',
    availability: 'IN_STOCK',
    geographicRestrictions: ['India'],
    offerStart: new Date(Date.now() - 86400000).toISOString(),
    expiryDate: new Date(Date.now() + 14 * 86400000).toISOString(),
    sourceUrl: 'https://www.desidime.com/coupons/ajio-all-star-sale',
    sourceDomain: 'desidime.com',
    sourceType: 'PUBLIC_DEAL_FEED'
  },
  {
    title: 'Zoho Workplace Annual Subscription Promotion',
    brand: 'Zoho',
    merchant: 'Zoho India',
    category: 'SaaS & Business Software',
    productUrl: 'https://www.zoho.com/workplace/special-offer',
    dealKind: 'COUPON',
    couponConditions: '20% off on all annual business plans with free custom domain configuration',
    availability: 'IN_STOCK',
    geographicRestrictions: ['India'],
    offerStart: new Date(Date.now() - 86400000).toISOString(),
    sourceUrl: 'https://www.zoho.com/workplace/promotions',
    sourceDomain: 'zoho.com',
    sourceType: 'RETAILER_BRAND'
  }
];

export const getSampleDealCandidatesFixture = (): DiscoveredDealInput[] => {
  return JSON.parse(JSON.stringify(SAMPLE_DEAL_CANDIDATES_FIXTURE));
};

export const getSampleCouponCandidatesFixture = (): DiscoveredDealInput[] => {
  return JSON.parse(JSON.stringify(SAMPLE_COUPON_CANDIDATES_FIXTURE));
};
