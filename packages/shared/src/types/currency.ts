/**
 * Universal Currency & Money Metadata Registry
 * Authoritative ISO-4217 standard currency definitions, precision, and conversions.
 */

export interface CurrencyMetadata {
  code: string;
  decimals: number;
  symbol: string;
  name: string;
  supportedPaymentProviders: ('STRIPE' | 'RAZORPAY' | 'MANUAL')[];
  defaultLocale: string;
}

export interface Money {
  amountMinor: number;
  currency: string;
}

export const CURRENCY_REGISTRY: Record<string, CurrencyMetadata> = {
  USD: {
    code: 'USD',
    decimals: 2,
    symbol: '$',
    name: 'US Dollar',
    supportedPaymentProviders: ['STRIPE', 'MANUAL'],
    defaultLocale: 'en-US'
  },
  EUR: {
    code: 'EUR',
    decimals: 2,
    symbol: '€',
    name: 'Euro',
    supportedPaymentProviders: ['STRIPE', 'MANUAL'],
    defaultLocale: 'de-DE'
  },
  GBP: {
    code: 'GBP',
    decimals: 2,
    symbol: '£',
    name: 'British Pound',
    supportedPaymentProviders: ['STRIPE', 'MANUAL'],
    defaultLocale: 'en-GB'
  },
  INR: {
    code: 'INR',
    decimals: 2,
    symbol: '₹',
    name: 'Indian Rupee',
    supportedPaymentProviders: ['RAZORPAY', 'STRIPE', 'MANUAL'],
    defaultLocale: 'en-IN'
  },
  AED: {
    code: 'AED',
    decimals: 2,
    symbol: 'د.إ',
    name: 'UAE Dirham',
    supportedPaymentProviders: ['STRIPE', 'MANUAL'],
    defaultLocale: 'ar-AE'
  },
  CAD: {
    code: 'CAD',
    decimals: 2,
    symbol: 'CA$',
    name: 'Canadian Dollar',
    supportedPaymentProviders: ['STRIPE', 'MANUAL'],
    defaultLocale: 'en-CA'
  },
  AUD: {
    code: 'AUD',
    decimals: 2,
    symbol: 'A$',
    name: 'Australian Dollar',
    supportedPaymentProviders: ['STRIPE', 'MANUAL'],
    defaultLocale: 'en-AU'
  },
  SGD: {
    code: 'SGD',
    decimals: 2,
    symbol: 'S$',
    name: 'Singapore Dollar',
    supportedPaymentProviders: ['STRIPE', 'MANUAL'],
    defaultLocale: 'en-SG'
  },
  JPY: {
    code: 'JPY',
    decimals: 0,
    symbol: '¥',
    name: 'Japanese Yen',
    supportedPaymentProviders: ['STRIPE', 'MANUAL'],
    defaultLocale: 'ja-JP'
  },
  KWD: {
    code: 'KWD',
    decimals: 3,
    symbol: 'KD',
    name: 'Kuwaiti Dinar',
    supportedPaymentProviders: ['STRIPE', 'MANUAL'],
    defaultLocale: 'ar-KW'
  },
  BHD: {
    code: 'BHD',
    decimals: 3,
    symbol: 'BD',
    name: 'Bahraini Dinar',
    supportedPaymentProviders: ['STRIPE', 'MANUAL'],
    defaultLocale: 'ar-BH'
  },
  OMR: {
    code: 'OMR',
    decimals: 3,
    symbol: 'OMR',
    name: 'Omani Rial',
    supportedPaymentProviders: ['STRIPE', 'MANUAL'],
    defaultLocale: 'ar-OM'
  },
  SAR: {
    code: 'SAR',
    decimals: 2,
    symbol: 'SR',
    name: 'Saudi Riyal',
    supportedPaymentProviders: ['STRIPE', 'MANUAL'],
    defaultLocale: 'ar-SA'
  },
  QAR: {
    code: 'QAR',
    decimals: 2,
    symbol: 'QR',
    name: 'Qatari Riyal',
    supportedPaymentProviders: ['STRIPE', 'MANUAL'],
    defaultLocale: 'ar-QA'
  },
  KRW: {
    code: 'KRW',
    decimals: 0,
    symbol: '₩',
    name: 'South Korean Won',
    supportedPaymentProviders: ['STRIPE', 'MANUAL'],
    defaultLocale: 'ko-KR'
  }
};

export function isValidCurrency(currency?: string): boolean {
  if (!currency || typeof currency !== 'string') return false;
  return Boolean(CURRENCY_REGISTRY[currency.trim().toUpperCase()]);
}

export function getCurrencyMetadata(currency: string): CurrencyMetadata {
  const cur = (currency || '').trim().toUpperCase();
  const meta = CURRENCY_REGISTRY[cur];
  if (!meta) {
    throw new Error(`UNKNOWN_CURRENCY: Currency '${currency}' is not supported by the platform registry.`);
  }
  return meta;
}

export function toMinorUnits(amountMajor: number, currency: string = 'INR'): number {
  const meta = getCurrencyMetadata(currency);
  const factor = Math.pow(10, meta.decimals);
  return Math.round(amountMajor * factor);
}

export function toMajorUnits(amountMinor: number, currency: string = 'INR'): number {
  const meta = getCurrencyMetadata(currency);
  const factor = Math.pow(10, meta.decimals);
  return amountMinor / factor;
}

export function formatMoney(amountMinor: number, currency: string = 'INR', locale?: string): string {
  const meta = getCurrencyMetadata(currency);
  const major = toMajorUnits(amountMinor, currency);
  const targetLocale = locale || meta.defaultLocale;
  try {
    return new Intl.NumberFormat(targetLocale, {
      style: 'currency',
      currency: meta.code,
      minimumFractionDigits: meta.decimals,
      maximumFractionDigits: meta.decimals
    }).format(major);
  } catch {
    return `${meta.symbol}${major.toFixed(meta.decimals)}`;
  }
}
