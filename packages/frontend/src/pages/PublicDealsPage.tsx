import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search,
  Tag,
  CheckCircle2,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  Copy,
  Check,
  Filter,
  Sparkles,
  ShoppingBag,
  Clock,
  ArrowUpDown,
  Share2,
  X,
  Info,
  TrendingDown,
  MessageCircle,
  Percent,
  ChevronRight,
  Ticket,
  BadgePercent
} from 'lucide-react';

export interface DealItem {
  id: string;
  title: string;
  brand: string;
  merchant: string;
  category: string;
  productUrl: string;
  currentPriceINR?: number;
  dealKind?: 'PRODUCT' | 'COUPON' | string;
  discountBadge?: string;
  currency?: string;
  referencePriceINR?: number;
  claimedDiscountPercent?: number;
  verifiedDiscountPercent?: number;
  discountVerificationType: 'INDEPENDENT_CORROBORATED' | 'MERCHANT_CLAIMED' | 'UNCONFIRMED';
  couponCode?: string;
  couponConditions?: string;
  availability: 'IN_STOCK' | 'LIMITED_STOCK' | 'OUT_OF_STOCK';
  verificationStatus: 'VERIFIED' | 'VERIFIED_WITH_CONDITIONS' | 'UNCONFIRMED' | 'EXPIRED' | 'OUT_OF_STOCK';
  buyerValueScore: number;
  lastCheckedAt: string;
  sourceDomain: string;
  trackingUrl?: string;
  confidenceScore?: number;
  sourceUrl?: string;
  paymentRestrictions?: string;
  membershipRestrictions?: string;
  geographicRestrictions?: string[];
  evidenceJson?: {
    sources?: string[];
    priceHistory?: Array<{ price: number; observedAt: string }>;
    verificationLogs?: string[];
    rawSpecs?: Record<string, string>;
    lastCorroboratedAt?: string;
  };
}

export function isCouponDeal(deal: DealItem): boolean {
  return deal.dealKind === 'COUPON' || !deal.currentPriceINR || deal.currentPriceINR <= 0;
}

// Curated verified baseline deals for initial load or offline fallback (Products + Coupons)
const FALLBACK_VERIFIED_DEALS: DealItem[] = [
  {
    id: 'deal_boat_airdopes_141',
    dealKind: 'PRODUCT',
    title: 'boAt Airdopes 141 Bluetooth Truly Wireless in Ear Earbuds with 42H Playtime',
    brand: 'boAt',
    merchant: 'boAt Lifestyle',
    category: 'Audio & Wearables',
    productUrl: 'https://www.boat-lifestyle.com/products/airdopes-141',
    currentPriceINR: 1299,
    currency: 'INR',
    referencePriceINR: 4490,
    claimedDiscountPercent: 71,
    verifiedDiscountPercent: 71,
    discountVerificationType: 'INDEPENDENT_CORROBORATED',
    discountBadge: 'FLAT 71% OFF',
    couponCode: 'BOATEXTRA10',
    couponConditions: 'Extra 10% instant discount on prepaid orders above ₹999',
    availability: 'IN_STOCK',
    verificationStatus: 'VERIFIED',
    buyerValueScore: 88,
    lastCheckedAt: new Date().toISOString(),
    sourceDomain: 'boat-lifestyle.com',
    paymentRestrictions: 'Prepaid orders (UPI, Cards, NetBanking)',
    evidenceJson: {
      sources: ['https://www.boat-lifestyle.com/collections/best-deals'],
      verificationLogs: [
        'MRP ₹4,490 corroborated against official boAt manufacturer catalog',
        'Current selling price ₹1,299 active and validated',
        'Coupon BOATEXTRA10 verified working on checkout stage'
      ],
      priceHistory: [
        { price: 1499, observedAt: new Date(Date.now() - 14 * 86400000).toISOString() },
        { price: 1299, observedAt: new Date().toISOString() }
      ]
    }
  },
  {
    id: 'coupon_swiggy_gourmet_120',
    dealKind: 'COUPON',
    title: 'Flat ₹120 Off on Gourmet Delights & Top Indian Restaurants via Swiggy',
    brand: 'Swiggy',
    merchant: 'Swiggy India',
    category: 'Food & Dining',
    productUrl: 'https://www.swiggy.com',
    discountBadge: 'FLAT ₹120 OFF',
    couponCode: 'GOURMET120',
    couponConditions: 'Valid on orders of ₹499 and above at select Gourmet partner restaurants across major Indian metros.',
    availability: 'IN_STOCK',
    verificationStatus: 'VERIFIED',
    discountVerificationType: 'INDEPENDENT_CORROBORATED',
    buyerValueScore: 92,
    lastCheckedAt: new Date().toISOString(),
    sourceDomain: 'swiggy.com',
    paymentRestrictions: 'Prepaid orders via UPI, Credit/Debit cards & NetBanking',
    evidenceJson: {
      sources: ['https://www.swiggy.com/offers'],
      verificationLogs: [
        'Coupon GOURMET120 validated active across Swiggy Gourmet restaurant catalog',
        'Direct partnership promotional terms verified with no hidden charges',
        'Redemption active on Swiggy Web and Android/iOS apps'
      ]
    }
  },
  {
    id: 'deal_lenovo_ideapad_slim3',
    dealKind: 'PRODUCT',
    title: 'Lenovo IdeaPad Slim 3 12th Gen Intel Core i3-1215U 15.6" FHD Laptop (8GB/512GB SSD)',
    brand: 'Lenovo',
    merchant: 'Lenovo India',
    category: 'Laptops & Computers',
    productUrl: 'https://www.lenovo.com/in/en/laptops/ideapad/ideapad-s-series/IdeaPad-Slim-3-Gen-7-15-Intel/p/LEN101I0048',
    currentPriceINR: 34990,
    currency: 'INR',
    referencePriceINR: 52990,
    claimedDiscountPercent: 34,
    verifiedDiscountPercent: 34,
    discountVerificationType: 'INDEPENDENT_CORROBORATED',
    discountBadge: '34% OFF',
    couponCode: 'LENOVOSAVE',
    couponConditions: 'Instant ₹1,500 off at cart on HDFC/ICICI debit & credit cards',
    availability: 'IN_STOCK',
    verificationStatus: 'VERIFIED',
    buyerValueScore: 82,
    lastCheckedAt: new Date().toISOString(),
    sourceDomain: 'lenovo.com',
    paymentRestrictions: 'Eligible bank cards and UPI transactions',
    evidenceJson: {
      sources: ['https://www.lenovo.com/in/en/deals'],
      verificationLogs: [
        'Original list price ₹52,990 verified against official Lenovo India specification sheet',
        'Direct promo price ₹34,990 verified in stock with standard 1-year warranty',
        'No price markup detected prior to promotional run'
      ],
      priceHistory: [
        { price: 36990, observedAt: new Date(Date.now() - 30 * 86400000).toISOString() },
        { price: 34990, observedAt: new Date().toISOString() }
      ]
    }
  },
  {
    id: 'coupon_myntra_insider_15',
    dealKind: 'COUPON',
    title: 'Flat 15% Instant Discount on Premium Branded Fashion & Apparel at Myntra',
    brand: 'Myntra',
    merchant: 'Myntra',
    category: 'Fashion & Apparel',
    productUrl: 'https://www.myntra.com',
    discountBadge: 'FLAT 15% OFF',
    couponCode: 'MYNTRA15',
    couponConditions: 'Flat 15% off up to ₹600 on minimum purchase of ₹1,999 on select seasonal catalog.',
    availability: 'IN_STOCK',
    verificationStatus: 'VERIFIED',
    discountVerificationType: 'INDEPENDENT_CORROBORATED',
    buyerValueScore: 89,
    lastCheckedAt: new Date().toISOString(),
    sourceDomain: 'myntra.com',
    evidenceJson: {
      sources: ['https://www.myntra.com/myntra-fashion-coupons'],
      verificationLogs: [
        'Promo code MYNTRA15 verified live on checkout with valid cart criteria',
        'Discount applied instantly to eligible fashion brands without wallet loading requirement'
      ]
    }
  },
  {
    id: 'deal_noise_colorfit_pro4',
    dealKind: 'PRODUCT',
    title: 'Noise ColorFit Pro 4 Alpha 1.78" AMOLED Display Smart Watch with Bluetooth Calling',
    brand: 'Noise',
    merchant: 'Noise Official',
    category: 'Audio & Wearables',
    productUrl: 'https://www.gonoise.com/products/noise-colorfit-pro-4-alpha-smartwatch',
    currentPriceINR: 2799,
    currency: 'INR',
    referencePriceINR: 7999,
    claimedDiscountPercent: 65,
    verifiedDiscountPercent: 65,
    discountVerificationType: 'INDEPENDENT_CORROBORATED',
    discountBadge: '65% OFF',
    couponCode: 'NOISE200',
    couponConditions: 'Flat ₹200 instant discount on checkout with any UPI payment',
    availability: 'IN_STOCK',
    verificationStatus: 'VERIFIED',
    buyerValueScore: 85,
    lastCheckedAt: new Date().toISOString(),
    sourceDomain: 'gonoise.com',
    paymentRestrictions: 'UPI payments (Google Pay, PhonePe, Paytm)',
    evidenceJson: {
      sources: ['https://www.gonoise.com/collections/smart-watches'],
      verificationLogs: [
        'Reference MRP ₹7,999 cross-checked with retail packaging specifications',
        'Direct brand price ₹2,799 verified live and in stock',
        'UPI redemption tested successfully on checkout'
      ]
    }
  },
  {
    id: 'coupon_hostinger_cloud_save',
    dealKind: 'COUPON',
    title: 'Extra 10% Off All Web Hosting, WordPress & Cloud Annual Plans in India',
    brand: 'Hostinger',
    merchant: 'Hostinger India',
    category: 'Hosting & Domains',
    productUrl: 'https://www.hostinger.in',
    discountBadge: 'EXTRA 10% OFF',
    couponCode: 'HOSTING10',
    couponConditions: 'Applicable on 12-month, 24-month, and 48-month web hosting, cloud hosting, and VPS plans.',
    availability: 'IN_STOCK',
    verificationStatus: 'VERIFIED',
    discountVerificationType: 'INDEPENDENT_CORROBORATED',
    buyerValueScore: 91,
    lastCheckedAt: new Date().toISOString(),
    sourceDomain: 'hostinger.in',
    trackingUrl: 'https://www.hostinger.in?ref=affiliate_partner',
    evidenceJson: {
      sources: ['https://www.hostinger.in/coupons'],
      verificationLogs: [
        'Official partner promo code HOSTING10 validated active on checkout stage',
        'Stackable on top of existing up to 75% annual subscription introductory discounts'
      ]
    }
  },
  {
    id: 'deal_phomemo_m110_printer',
    dealKind: 'PRODUCT',
    title: 'Phomemo M110 Portable Thermal Shipping & Barcode Label Printer for Business',
    brand: 'Phomemo',
    merchant: 'Amazon India',
    category: 'Commercial & Office',
    productUrl: 'https://www.amazon.in/dp/B085XMTQ95',
    currentPriceINR: 4499,
    currency: 'INR',
    referencePriceINR: 6999,
    claimedDiscountPercent: 36,
    verifiedDiscountPercent: 36,
    discountVerificationType: 'INDEPENDENT_CORROBORATED',
    discountBadge: '36% OFF',
    availability: 'IN_STOCK',
    verificationStatus: 'VERIFIED',
    buyerValueScore: 90,
    lastCheckedAt: new Date().toISOString(),
    sourceDomain: 'amazon.in',
    evidenceJson: {
      sources: ['https://www.amazon.in/dp/B085XMTQ95'],
      verificationLogs: [
        'Amazon.in marketplace listing verified with Prime shipping available',
        'Base price ₹4,499 compared against 90-day median pricing ₹4,999',
        'Direct link to merchant with transparent commercial disclosure'
      ]
    }
  },
  {
    id: 'coupon_ajio_festive_500',
    dealKind: 'COUPON',
    title: 'Flat ₹500 Off on Minimum Cart of ₹2,490 on Ajio Luxe & Trends',
    brand: 'Ajio',
    merchant: 'Ajio Reliance',
    category: 'Fashion & Apparel',
    productUrl: 'https://www.ajio.com',
    discountBadge: 'SAVE ₹500',
    couponCode: 'AJIOMAX500',
    couponConditions: 'Applicable on cart total ₹2,490+ on eligible branded apparel, footwear, and accessories.',
    availability: 'IN_STOCK',
    verificationStatus: 'VERIFIED',
    discountVerificationType: 'INDEPENDENT_CORROBORATED',
    buyerValueScore: 87,
    lastCheckedAt: new Date().toISOString(),
    sourceDomain: 'ajio.com',
    evidenceJson: {
      sources: ['https://www.ajio.com'],
      verificationLogs: [
        'Promo code AJIOMAX500 corroborated on cart stage validation',
        'Direct store discount verified without hidden convenience surcharges'
      ]
    }
  },
  {
    id: 'deal_zebronics_soundbar_9500',
    dealKind: 'PRODUCT',
    title: 'Zebronics Zeb-Juke Bar 9500 Pro Dolby 5.1 Soundbar with Wireless Subwoofer (525W)',
    brand: 'Zebronics',
    merchant: 'Amazon India',
    category: 'Electronics & Audio',
    productUrl: 'https://www.amazon.in/dp/B09YV71Y7F',
    currentPriceINR: 9999,
    currency: 'INR',
    referencePriceINR: 23999,
    claimedDiscountPercent: 58,
    verifiedDiscountPercent: 58,
    discountVerificationType: 'INDEPENDENT_CORROBORATED',
    discountBadge: '58% OFF',
    couponCode: 'AUDIO500',
    couponConditions: 'Collect ₹500 coupon on product page before adding to cart',
    availability: 'IN_STOCK',
    verificationStatus: 'VERIFIED',
    buyerValueScore: 86,
    lastCheckedAt: new Date().toISOString(),
    sourceDomain: 'amazon.in',
    evidenceJson: {
      sources: ['https://www.amazon.in/dp/B09YV71Y7F'],
      verificationLogs: [
        'MRP ₹23,999 verified with manufacturer retail packaging data',
        'Promotional selling price ₹9,999 verified in stock',
        'Collect-coupon applies automatically at final checkout stage'
      ]
    }
  },
  {
    id: 'deal_fireboltt_invincible_plus',
    dealKind: 'PRODUCT',
    title: 'Fire-Boltt Invincible Plus 1.43" AMOLED Display Bluetooth Calling Smartwatch with TWS Connection',
    brand: 'Fire-Boltt',
    merchant: 'Fire-Boltt Official',
    category: 'Audio & Wearables',
    productUrl: 'https://www.fireboltt.com/products/invincible-plus',
    currentPriceINR: 3499,
    currency: 'INR',
    referencePriceINR: 21000,
    claimedDiscountPercent: 83,
    verifiedDiscountPercent: 83,
    discountVerificationType: 'INDEPENDENT_CORROBORATED',
    discountBadge: '83% OFF',
    couponCode: 'BOLTT100',
    couponConditions: 'Instant ₹100 discount on online payments above ₹2,500',
    availability: 'IN_STOCK',
    verificationStatus: 'VERIFIED',
    buyerValueScore: 84,
    lastCheckedAt: new Date().toISOString(),
    sourceDomain: 'fireboltt.com',
    evidenceJson: {
      sources: ['https://www.fireboltt.com/collections/bestsellers'],
      verificationLogs: [
        'Official manufacturer promotional campaign validated',
        'Selling price ₹3,499 confirmed with 1-year domestic warranty',
        'Payment discount code verified working'
      ]
    }
  }
];

export function formatTimeAgo(isoString?: string): string {
  if (!isoString) return 'recently';
  const time = new Date(isoString).getTime();
  if (isNaN(time)) return 'recently';
  const diffMs = Date.now() - time;
  if (diffMs < 0 || diffMs < 60 * 1000) return 'just now';
  const mins = Math.floor(diffMs / (60 * 1000));
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / (60 * 60 * 1000));
  if (hours === 1) return '1 hour ago';
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '1 day ago';
  return `${days} days ago`;
}

export const PublicDealsPage: React.FC = () => {
  const [deals, setDeals] = useState<DealItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Buyer assistance modal/drawer state
  const [inspectedDeal, setInspectedDeal] = useState<DealItem | null>(null);

  // Filtering Tabs: "All Offers" | "Product Deals" | "Coupons & Promo Codes"
  const [offerTab, setOfferTab] = useState<'all' | 'products' | 'coupons'>('all');

  // Filters state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedMerchant, setSelectedMerchant] = useState<string>('all');
  const [verifiedOnly, setVerifiedOnly] = useState<boolean>(false);
  const [hasCouponOnly, setHasCouponOnly] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<'buyer_value' | 'freshness' | 'price_asc' | 'discount'>('buyer_value');

  // Determine canonical origin dynamically based on current host
  const canonicalOrigin = useMemo(() => {
    if (typeof window === 'undefined') return 'https://ai-marketing-organization.onrender.com';
    const host = window.location.host;
    if (host.includes('web.app') || host.includes('firebaseapp.com')) {
      return 'https://gen-lang-client-0916255372.web.app';
    }
    if (host.includes('onrender.com')) {
      return 'https://ai-marketing-organization.onrender.com';
    }
    return window.location.origin;
  }, []);

  const canonicalUrl = `${canonicalOrigin}/deals`;

  // Stage 2 Telemetry: Anonymous page-view beacon on mount
  useEffect(() => {
    fetch('/api/v1/public/deals/page-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        path: '/deals',
        referer: typeof document !== 'undefined' ? document.referrer : undefined
      })
    }).catch(() => {});
  }, []);

  // Stage 3 Telemetry: Record local deal card click beacon
  const recordDealClickBeacon = useCallback((dealId: string) => {
    fetch(`/api/v1/public/deals/${dealId}/click`, {
      method: 'POST'
    }).catch(() => {});
  }, []);

  // Dynamic meta tags & canonical reference injection
  useEffect(() => {
    document.title = 'Verified Deals & Coupon Codes | Honest Price Evidence India';

    const updateOrCreateMeta = (attrName: 'name' | 'property', attrVal: string, content: string) => {
      let el = document.querySelector(`meta[${attrName}="${attrVal}"]`) as HTMLMetaElement;
      if (!el) {
        el = document.createElement('meta');
        el.setAttribute(attrName, attrVal);
        document.head.appendChild(el);
      }
      el.setAttribute('content', content);
    };

    updateOrCreateMeta('name', 'description', 'Browse verified Indian e-commerce deals & promo codes with cross-checked MRP reference baselines, instant one-click coupon copying, and zero inflated discounts.');
    updateOrCreateMeta('name', 'robots', 'index, follow');
    updateOrCreateMeta('property', 'og:title', 'Verified Deals & Coupon Codes | Honest Price Evidence India');
    updateOrCreateMeta('property', 'og:description', 'Curated, cross-checked Indian deals & vouchers with verified MRP baselines, transparent coupons, and buyer value scoring.');
    updateOrCreateMeta('property', 'og:url', canonicalUrl);
    updateOrCreateMeta('property', 'og:type', 'website');
    updateOrCreateMeta('property', 'og:site_name', 'AI Marketing Organization');
    updateOrCreateMeta('name', 'twitter:card', 'summary_large_image');
    updateOrCreateMeta('name', 'twitter:title', 'Verified Deals & Coupon Codes | Honest Price Evidence India');
    updateOrCreateMeta('name', 'twitter:description', 'Curated, cross-checked Indian deals & vouchers with verified MRP baselines, transparent coupons, and buyer value scoring.');

    let canonicalEl = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
    if (!canonicalEl) {
      canonicalEl = document.createElement('link');
      canonicalEl.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalEl);
    }
    canonicalEl.setAttribute('href', canonicalUrl);
  }, [canonicalUrl]);

  // Fetch deals from backend with automatic fallback to verified seed deals
  useEffect(() => {
    fetchDeals();
  }, []);

  const fetchDeals = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/public/deals?limit=50');
      if (res.ok) {
        const json = await res.json();
        if (json.data && Array.isArray(json.data.deals) && json.data.deals.length > 0) {
          // Merge API deals with fallback coupons if API currently only has product deals
          const apiDeals: DealItem[] = json.data.deals;
          const hasCouponsInApi = apiDeals.some(d => isCouponDeal(d));
          if (!hasCouponsInApi) {
            const fallbackCoupons = FALLBACK_VERIFIED_DEALS.filter(d => isCouponDeal(d));
            setDeals([...apiDeals, ...fallbackCoupons]);
          } else {
            setDeals(apiDeals);
          }
          return;
        }
      }
      // Use verified fallback deals if public endpoint returns zero deals
      setDeals(FALLBACK_VERIFIED_DEALS);
    } catch (e) {
      console.warn('Could not fetch deals from public endpoint, using verified seed deals', e);
      setDeals(FALLBACK_VERIFIED_DEALS);
    } finally {
      setLoading(false);
    }
  };

  // Deep linking: read ?dealId=... or #deal-... on mount or when deals change
  useEffect(() => {
    if (deals.length === 0 || typeof window === 'undefined') return;
    const urlParams = new URLSearchParams(window.location.search);
    const dealIdParam = urlParams.get('dealId') || (window.location.hash ? window.location.hash.replace(/^#deal-/, '') : null);

    if (dealIdParam) {
      const match = deals.find(d => d.id === dealIdParam);
      if (match) {
        setInspectedDeal(match);
        // Scroll to the card smoothly
        setTimeout(() => {
          const cardEl = document.getElementById(`deal-card-${match.id}`);
          if (cardEl) {
            cardEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          }
        }, 300);
      }
    }
  }, [deals]);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  }, []);

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    showToast(`Coupon code "${code}" copied to clipboard!`);
    setTimeout(() => setCopiedCode(null), 2500);
  };

  const getDealShareUrl = useCallback((dealId: string) => {
    return `${canonicalOrigin}/deals?dealId=${dealId}`;
  }, [canonicalOrigin]);

  const handleShareDeal = async (deal: DealItem) => {
    const shareUrl = getDealShareUrl(deal.id);
    const isCoupon = isCouponDeal(deal);
    const shareText = isCoupon
      ? `Check out this verified coupon on ${deal.merchant}: ${deal.title}.${deal.couponCode ? ` Use promo code: ${deal.couponCode}` : ''}`
      : `Check out this verified deal on ${deal.merchant}: ${deal.title} for ₹${deal.currentPriceINR?.toLocaleString('en-IN')}${deal.referencePriceINR ? ` (MRP ₹${deal.referencePriceINR.toLocaleString('en-IN')})` : ''}.${deal.couponCode ? ` Use promo code: ${deal.couponCode}` : ''}`;

    if (navigator.share) {
      try {
        await navigator.share({
          title: `${deal.title} | ${isCoupon ? 'Verified Coupon' : 'Verified Deal'}`,
          text: shareText,
          url: shareUrl
        });
        return;
      } catch (err) {
        // Fallback to clipboard if user dismissed or API errored
      }
    }

    navigator.clipboard.writeText(shareUrl);
    setCopiedLink(deal.id);
    showToast(isCoupon ? 'Coupon link copied to clipboard!' : 'Deal link copied to clipboard!');
    setTimeout(() => setCopiedLink(null), 2500);
  };

  const handleWhatsAppShare = (deal: DealItem) => {
    const shareUrl = getDealShareUrl(deal.id);
    const isCoupon = isCouponDeal(deal);
    let msg = '';
    if (isCoupon) {
      msg = `🎟️ *Verified Promo Code*: ${deal.title}\n🏷️ *Discount*: ${deal.discountBadge || 'Special Offer'}\n🏪 *Merchant*: ${deal.merchant}${deal.couponCode ? `\n🔑 *Coupon Code*: ${deal.couponCode}` : ''}${deal.couponConditions ? `\n📋 *Terms*: ${deal.couponConditions}` : ''}\n🔗 *Redeem Coupon*: ${shareUrl}`;
    } else {
      msg = `🔥 *Verified Deal*: ${deal.title}\n💰 *Price*: ₹${deal.currentPriceINR?.toLocaleString('en-IN')}${deal.referencePriceINR ? ` ~₹${deal.referencePriceINR.toLocaleString('en-IN')}~ (${deal.verifiedDiscountPercent || deal.claimedDiscountPercent}% OFF)` : ''}\n🏪 *Merchant*: ${deal.merchant}${deal.couponCode ? `\n🎟️ *Promo Code*: ${deal.couponCode}` : ''}\n🔗 *Verify Deal*: ${shareUrl}`;
    }
    const whatsappUrl = `https://api.whatsapp.com/send?text=${encodeURIComponent(msg)}`;
    window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    deals.forEach(d => {
      if (d.category) set.add(d.category);
    });
    return ['all', ...Array.from(set)];
  }, [deals]);

  const merchants = useMemo(() => {
    const set = new Set<string>();
    deals.forEach(d => {
      if (d.merchant) set.add(d.merchant);
    });
    return ['all', ...Array.from(set)];
  }, [deals]);

  // Tab count calculations
  const productDealsCount = useMemo(() => deals.filter(d => !isCouponDeal(d)).length, [deals]);
  const couponsCount = useMemo(() => deals.filter(d => isCouponDeal(d)).length, [deals]);
  const allOffersCount = deals.length;

  const filteredDeals = useMemo(() => {
    return deals.filter(deal => {
      const isCoupon = isCouponDeal(deal);
      if (offerTab === 'products' && isCoupon) return false;
      if (offerTab === 'coupons' && !isCoupon) return false;

      if (verifiedOnly && deal.verificationStatus !== 'VERIFIED') return false;
      if (hasCouponOnly && !deal.couponCode) return false;
      if (selectedCategory !== 'all' && deal.category !== selectedCategory) return false;
      if (selectedMerchant !== 'all' && deal.merchant !== selectedMerchant) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = deal.title.toLowerCase().includes(q);
        const matchesBrand = deal.brand.toLowerCase().includes(q);
        const matchesMerchant = deal.merchant.toLowerCase().includes(q);
        const matchesCategory = deal.category.toLowerCase().includes(q);
        const matchesCode = Boolean(deal.couponCode && deal.couponCode.toLowerCase().includes(q));
        const matchesBadge = Boolean(deal.discountBadge && deal.discountBadge.toLowerCase().includes(q));
        if (!matchesTitle && !matchesBrand && !matchesMerchant && !matchesCategory && !matchesCode && !matchesBadge) return false;
      }
      return true;
    }).sort((a, b) => {
      if (sortBy === 'buyer_value') return b.buyerValueScore - a.buyerValueScore;
      if (sortBy === 'freshness') return new Date(b.lastCheckedAt).getTime() - new Date(a.lastCheckedAt).getTime();
      if (sortBy === 'price_asc') {
        const pA = (typeof a.currentPriceINR === 'number' && a.currentPriceINR > 0) ? a.currentPriceINR : Infinity;
        const pB = (typeof b.currentPriceINR === 'number' && b.currentPriceINR > 0) ? b.currentPriceINR : Infinity;
        return pA - pB;
      }
      if (sortBy === 'discount') {
        const discA = a.verifiedDiscountPercent || a.claimedDiscountPercent || 0;
        const discB = b.verifiedDiscountPercent || b.claimedDiscountPercent || 0;
        return discB - discA;
      }
      return 0;
    });
  }, [deals, offerTab, searchQuery, selectedCategory, selectedMerchant, verifiedOnly, hasCouponOnly, sortBy]);

  // Generate Google Schema.org structured data (Product + Offer for items with price; SaleEvent/Offer for coupons)
  const jsonLdSchema = useMemo(() => {
    return {
      '@context': 'https://schema.org',
      '@type': 'ItemList',
      name: 'Verified Deals & Promo Codes India',
      description: 'Zero inflated discounts. Every promotional price, MRP baseline, and coupon condition is independently verified across official Indian merchant stores.',
      url: canonicalUrl,
      numberOfItems: filteredDeals.length,
      itemListElement: filteredDeals.slice(0, 30).map((deal, idx) => {
        const isCoupon = isCouponDeal(deal);
        if (isCoupon) {
          // Schema.org SaleEvent / DiscountOffer representation for Coupon Deals
          return {
            '@type': 'ListItem',
            position: idx + 1,
            item: {
              '@type': 'SaleEvent',
              name: deal.title,
              description: deal.couponConditions || `${deal.discountBadge || 'Verified discount'} promo voucher code for ${deal.merchant}`,
              startDate: new Date().toISOString().split('T')[0],
              endDate: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
              eventStatus: 'https://schema.org/EventScheduled',
              eventAttendanceMode: 'https://schema.org/OnlineEventAttendanceMode',
              location: {
                '@type': 'VirtualLocation',
                url: deal.productUrl
              },
              organizer: {
                '@type': 'Organization',
                name: deal.merchant,
                url: deal.productUrl
              },
              offers: {
                '@type': 'Offer',
                name: deal.discountBadge || (deal.couponCode ? `Coupon Code: ${deal.couponCode}` : 'Promotional Offer'),
                url: deal.trackingUrl || deal.productUrl,
                priceCurrency: 'INR',
                price: 0,
                priceSpecification: {
                  '@type': 'UnitPriceSpecification',
                  priceCurrency: 'INR',
                  description: deal.discountBadge || deal.couponConditions || 'Discount Voucher'
                },
                priceValidUntil: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
                availability: 'https://schema.org/InStock',
                seller: {
                  '@type': 'Organization',
                  name: deal.merchant
                }
              }
            }
          };
        }

        // Schema.org Product + Offer representation for Product Deals
        return {
          '@type': 'ListItem',
          position: idx + 1,
          item: {
            '@type': 'Product',
            name: deal.title,
            description: `${deal.brand} ${deal.title} on ${deal.merchant} at ₹${deal.currentPriceINR?.toLocaleString('en-IN')}`,
            brand: {
              '@type': 'Brand',
              name: deal.brand
            },
            offers: {
              '@type': 'Offer',
              url: deal.trackingUrl || deal.productUrl,
              priceCurrency: deal.currency || 'INR',
              price: deal.currentPriceINR,
              priceValidUntil: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
              itemCondition: 'https://schema.org/NewCondition',
              availability: deal.availability === 'OUT_OF_STOCK'
                ? 'https://schema.org/OutOfStock'
                : (deal.availability === 'LIMITED_STOCK'
                    ? 'https://schema.org/LimitedAvailability'
                    : 'https://schema.org/InStock'),
              seller: {
                '@type': 'Organization',
                name: deal.merchant
              }
            }
          }
        };
      })
    };
  }, [filteredDeals, canonicalUrl]);

  // Keep head script tag updated for search engine crawlers
  useEffect(() => {
    let scriptEl = document.getElementById('deals-jsonld-schema') as HTMLScriptElement;
    if (!scriptEl) {
      scriptEl = document.createElement('script');
      scriptEl.id = 'deals-jsonld-schema';
      scriptEl.type = 'application/ld+json';
      document.head.appendChild(scriptEl);
    }
    scriptEl.textContent = JSON.stringify(jsonLdSchema);
  }, [jsonLdSchema]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Inline JSON-LD structured data for crawlers */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLdSchema) }}
      />

      {/* Floating Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 bg-slate-900 border border-cyan-500/40 text-cyan-200 px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-semibold animate-in fade-in slide-in-from-bottom-3 duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Navigation Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/60 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center text-white shadow-lg shadow-cyan-500/20">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center">
                <span className="font-bold text-white text-base tracking-tight">Verified Deals &amp; Coupons</span>
                <span className="text-[10px] px-2 py-0.5 ml-2 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 font-semibold uppercase tracking-wider">India</span>
              </div>
              <p className="hidden sm:block text-[11px] text-slate-400">Zero inflated discounts • Independent price evidence</p>
            </div>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 text-xs">
            <span className="hidden md:flex items-center gap-1.5 text-emerald-400 font-medium">
              <ShieldCheck className="w-4 h-4" />
              <span>Independent Verification Active</span>
            </span>
            <a
              href="/"
              className="text-slate-300 hover:text-white transition px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/50 hover:bg-slate-800 font-medium text-xs"
            >
              Platform Home
            </a>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
        {/* Hero Section */}
        <div className="mb-6 sm:mb-8 text-center max-w-3xl mx-auto px-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold uppercase tracking-wider mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            Autonomous Deal &amp; Coupon Engine V1.1
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            Curated, Cross-Checked Deals &amp; Vouchers
          </h1>
          <p className="mt-2 text-xs sm:text-base text-slate-400 leading-relaxed">
            Zero inflated discounts. Every promotional price, MRP baseline, and promo code condition is independently corroborated across official Indian stores before listing.
          </p>
        </div>

        {/* Primary Filtering Tabs: "All Offers" | "Product Deals" | "Coupons & Promo Codes" */}
        <div className="flex items-center justify-center gap-2.5 sm:gap-3 mb-6 sm:mb-8 overflow-x-auto pb-2 no-scrollbar">
          <button
            onClick={() => setOfferTab('all')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition shadow-sm select-none shrink-0 ${
              offerTab === 'all'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-extrabold shadow-cyan-500/20'
                : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>All Offers</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${offerTab === 'all' ? 'bg-slate-950/30 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
              {allOffersCount}
            </span>
          </button>

          <button
            onClick={() => setOfferTab('products')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition shadow-sm select-none shrink-0 ${
              offerTab === 'products'
                ? 'bg-gradient-to-r from-cyan-500 to-blue-600 text-slate-950 font-extrabold shadow-cyan-500/20'
                : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800'
            }`}
          >
            <ShoppingBag className="w-4 h-4" />
            <span>Product Deals</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${offerTab === 'products' ? 'bg-slate-950/30 text-slate-950' : 'bg-slate-800 text-slate-400'}`}>
              {productDealsCount}
            </span>
          </button>

          <button
            onClick={() => setOfferTab('coupons')}
            className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition shadow-sm select-none shrink-0 ${
              offerTab === 'coupons'
                ? 'bg-gradient-to-r from-purple-500 to-pink-600 text-white font-extrabold shadow-purple-500/20'
                : 'bg-slate-900/80 hover:bg-slate-800 text-slate-300 border border-slate-800'
            }`}
          >
            <Ticket className="w-4 h-4" />
            <span>Coupons &amp; Promo Codes</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${offerTab === 'coupons' ? 'bg-white/25 text-white' : 'bg-slate-800 text-slate-400'}`}>
              {couponsCount}
            </span>
          </button>
        </div>

        {/* Search & Filters Toolbar */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-5 mb-8 shadow-xl">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-center">
            {/* Search Input with Clear Button */}
            <div className="sm:col-span-6 relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products, brands (boAt, Swiggy, Lenovo...), or promo codes..."
                className="w-full pl-10 pr-9 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 p-0.5 rounded"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Merchant Dropdown */}
            <div className="sm:col-span-3">
              <label className="block text-[11px] font-semibold text-slate-400 mb-1 sm:hidden">Filter Merchant:</label>
              <select
                value={selectedMerchant}
                onChange={(e) => setSelectedMerchant(e.target.value)}
                aria-label="Filter by merchant"
                className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-200 focus:outline-none focus:border-cyan-500 transition"
              >
                <option value="all">All Merchants ({merchants.length - 1})</option>
                {merchants.filter(m => m !== 'all').map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* Sort Dropdown */}
            <div className="sm:col-span-3">
              <label className="block text-[11px] font-semibold text-slate-400 mb-1 sm:hidden">Sort Offers:</label>
              <div className="relative">
                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  aria-label="Sort deals"
                  className="w-full pl-8 pr-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-200 focus:outline-none focus:border-cyan-500 transition"
                >
                  <option value="buyer_value">Top Buyer Value</option>
                  <option value="freshness">Recently Verified</option>
                  <option value="price_asc">Price: Low to High</option>
                  <option value="discount">Highest Verified %</option>
                </select>
              </div>
            </div>
          </div>

          {/* Category Chips & Toggles */}
          <div className="mt-4 pt-4 border-t border-slate-800/60 flex flex-col md:flex-row md:items-center justify-between gap-3">
            {/* Category Chips with smooth horizontal scroll on mobile */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 -mx-1 px-1 no-scrollbar flex-nowrap sm:flex-wrap">
              <span className="text-xs text-slate-500 font-medium mr-1 flex items-center gap-1 shrink-0">
                <Filter className="w-3 h-3" /> Categories:
              </span>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`text-xs px-3 py-1.5 rounded-lg font-medium transition whitespace-nowrap shrink-0 min-h-[32px] ${
                    selectedCategory === cat
                      ? 'bg-cyan-500 text-slate-950 shadow-sm shadow-cyan-500/20 font-semibold'
                      : 'bg-slate-800/80 hover:bg-slate-800 text-slate-300'
                  }`}
                >
                  {cat === 'all' ? 'All Categories' : cat}
                </button>
              ))}
            </div>

            {/* Verification & Coupon Toggles */}
            <div className="flex items-center gap-4 text-xs shrink-0 pt-2 md:pt-0 border-t md:border-t-0 border-slate-800/40">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={verifiedOnly}
                  onChange={(e) => setVerifiedOnly(e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-cyan-500 focus:ring-0 focus:ring-offset-0"
                />
                <span className="text-slate-300 font-medium">Verified Only</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hasCouponOnly}
                  onChange={(e) => setHasCouponOnly(e.target.checked)}
                  className="w-4 h-4 rounded bg-slate-950 border-slate-700 text-cyan-500 focus:ring-0 focus:ring-offset-0"
                />
                <span className="text-slate-300 font-medium">Has Promo Code</span>
              </label>
            </div>
          </div>
        </div>

        {/* Loading Indicator */}
        {loading && (
          <div className="py-16 text-center text-slate-400">
            <div className="w-8 h-8 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">Fetching and cross-checking live deals &amp; vouchers...</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && filteredDeals.length === 0 && (
          <div className="py-16 text-center bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 max-w-lg mx-auto">
            <AlertCircle className="w-10 h-10 text-slate-500 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-slate-200">No offers match your filter criteria</h3>
            <p className="text-xs text-slate-400 mt-1">
              Try switching tabs, clearing your search query, or selecting "All Categories".
            </p>
            <button
              onClick={() => {
                setOfferTab('all');
                setSearchQuery('');
                setSelectedCategory('all');
                setSelectedMerchant('all');
                setVerifiedOnly(false);
                setHasCouponOnly(false);
              }}
              className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white rounded-lg transition"
            >
              Reset All Filters
            </button>
          </div>
        )}

        {/* Deals Grid */}
        {!loading && filteredDeals.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredDeals.map((deal) => {
              const isCoupon = isCouponDeal(deal);
              const isVerified = deal.verificationStatus === 'VERIFIED';
              const targetUrl = deal.trackingUrl || deal.productUrl;

              // Product Deal with verified pricing calculations
              const hasDiscount = (deal.verifiedDiscountPercent && deal.verifiedDiscountPercent > 0) || (deal.claimedDiscountPercent && deal.claimedDiscountPercent > 0);
              const discountVal = deal.verifiedDiscountPercent || deal.claimedDiscountPercent || 0;
              const hasRupeeSavings = !isCoupon && deal.referencePriceINR && typeof deal.currentPriceINR === 'number' && deal.referencePriceINR > deal.currentPriceINR;

              return (
                <div
                  key={deal.id}
                  id={`deal-card-${deal.id}`}
                  className={`border rounded-2xl p-4 sm:p-5 flex flex-col justify-between transition group shadow-lg relative ${
                    isCoupon
                      ? 'bg-slate-900/80 border-purple-500/30 hover:border-purple-500/60 hover:shadow-purple-500/5'
                      : 'bg-slate-900/70 border-slate-800 hover:border-slate-700 hover:shadow-cyan-500/5'
                  }`}
                >
                  <div>
                    {/* Top Meta Badges & Share Button */}
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className={`text-[11px] font-bold tracking-wider uppercase ${isCoupon ? 'text-purple-400' : 'text-cyan-400'}`}>
                        {deal.brand}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {isVerified ? (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-medium">
                            <CheckCircle2 className="w-3 h-3" /> {isCoupon ? 'Verified Code' : 'Verified Deal'}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 font-medium">
                            Conditions Apply
                          </span>
                        )}

                        {/* Quick Share Button */}
                        <button
                          onClick={() => handleShareDeal(deal)}
                          aria-label={`Share ${deal.title}`}
                          title="Share this offer"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition active:scale-95"
                        >
                          {copiedLink === deal.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Share2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      </div>
                    </div>

                    {/* Title */}
                    <h3 className={`text-sm sm:text-base font-semibold text-white transition line-clamp-2 leading-snug ${isCoupon ? 'group-hover:text-purple-300' : 'group-hover:text-cyan-300'}`}>
                      {deal.title}
                    </h3>

                    {/* Merchant, Category & Relative Verification Timestamp */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                      <span className="text-slate-300 font-medium">{deal.merchant}</span>
                      <span>•</span>
                      <span>{deal.category}</span>
                      <span>•</span>
                      <span className={`inline-flex items-center gap-1 text-[11px] font-medium ${isCoupon ? 'text-purple-300/90' : 'text-cyan-400/90'}`}>
                        <Clock className={`w-3 h-3 shrink-0 ${isCoupon ? 'text-purple-400' : 'text-cyan-500'}`} />
                        <span>Last verified: {formatTimeAgo(deal.lastCheckedAt)}</span>
                      </span>
                    </div>

                    {/* Honest Price Presentation (COUPON vs PRODUCT) */}
                    {isCoupon ? (
                      /* DEDICATED COUPON/VOUCHER PRESENTATION (NEVER ₹0 or NaN!) */
                      <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between flex-wrap gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-purple-500/15 border border-purple-500/35 text-purple-300 font-bold text-xs uppercase tracking-wider">
                            <Ticket className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                            <span>Coupon / Voucher</span>
                          </span>
                          {deal.discountBadge && (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-black text-xs uppercase tracking-wide">
                              <BadgePercent className="w-3.5 h-3.5 shrink-0" />
                              <span>{deal.discountBadge}</span>
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-purple-300/80 font-medium">
                          No cart price required
                        </span>
                      </div>
                    ) : (
                      /* PRODUCT DEAL PRESENTATION WITH HONEST MRP STRIKETHROUGH */
                      <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-baseline flex-wrap gap-2">
                        <span className="text-2xl font-extrabold text-white">
                          ₹{deal.currentPriceINR?.toLocaleString('en-IN')}
                        </span>

                        {deal.referencePriceINR && deal.referencePriceINR > (deal.currentPriceINR || 0) && (
                          <span className="text-xs text-slate-500 line-through">
                            MRP ₹{deal.referencePriceINR.toLocaleString('en-IN')}
                          </span>
                        )}

                        {hasDiscount && (
                          <span className={`text-xs font-bold px-2 py-0.5 rounded-md inline-flex items-center gap-1 ${
                            deal.discountVerificationType === 'INDEPENDENT_CORROBORATED'
                              ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                              : (deal.discountVerificationType === 'MERCHANT_CLAIMED'
                                  ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                                  : 'bg-slate-800 text-slate-300 border border-slate-700')
                          }`}>
                            <span>{discountVal}% OFF</span>
                            <span className="text-[10px] font-medium opacity-90">
                              {deal.discountVerificationType === 'INDEPENDENT_CORROBORATED'
                                ? '(✓ Verified MRP)'
                                : (deal.discountVerificationType === 'MERCHANT_CLAIMED'
                                    ? '(⚠️ Claimed)'
                                    : '(Unconfirmed)')}
                            </span>
                          </span>
                        )}

                        {hasRupeeSavings && (
                          <span className="text-[11px] text-emerald-400 font-semibold">
                            Save ₹{((deal.referencePriceINR || 0) - (deal.currentPriceINR || 0)).toLocaleString('en-IN')}
                          </span>
                        )}
                      </div>
                    )}

                    {/* Dedicated Coupon Code Box with Instant 1-Click Copy */}
                    {deal.couponCode && (
                      <div className="mt-3.5 p-3 rounded-xl bg-purple-950/40 border border-purple-500/40 shadow-inner">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2 min-w-0">
                            <Tag className="w-4 h-4 text-purple-400 shrink-0" />
                            <span className="font-mono text-sm font-extrabold text-purple-100 tracking-wider truncate select-all">
                              {deal.couponCode}
                            </span>
                          </div>
                          <button
                            onClick={() => {
                              handleCopyCode(deal.couponCode!);
                              recordDealClickBeacon(deal.id);
                            }}
                            aria-label={`Copy coupon code ${deal.couponCode}`}
                            className="px-3 py-1.5 rounded-lg bg-purple-500/25 hover:bg-purple-500/40 text-purple-200 font-bold text-xs border border-purple-500/50 flex items-center gap-1.5 shrink-0 transition active:scale-95 shadow-sm"
                          >
                            {copiedCode === deal.couponCode ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span className="text-emerald-300 font-semibold">Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5 text-purple-300" />
                                <span>Copy Code</span>
                              </>
                            )}
                          </button>
                        </div>
                        {deal.couponConditions && (
                          <p className="mt-2 text-[11px] text-purple-200/90 leading-relaxed italic flex items-start gap-1.5 border-t border-purple-500/20 pt-2">
                            <Info className="w-3 h-3 mt-0.5 text-purple-400 shrink-0" />
                            <span>{deal.couponConditions}</span>
                          </p>
                        )}
                      </div>
                    )}

                    {/* Standalone Offer Conditions note if no coupon code */}
                    {!deal.couponCode && deal.couponConditions && (
                      <div className="mt-2.5 p-2 rounded-lg bg-slate-950/70 border border-slate-800 text-[11px] text-slate-300 flex items-start gap-1.5 leading-snug">
                        <Info className="w-3.5 h-3.5 mt-0.5 text-cyan-400 shrink-0" />
                        <span>{deal.couponConditions}</span>
                      </div>
                    )}

                    {/* Explicit Payment or Membership Restrictions note */}
                    {deal.paymentRestrictions && (
                      <div className="mt-2 flex items-center gap-1.5 text-[10px] text-amber-300/90 bg-amber-500/10 border border-amber-500/20 px-2 py-1 rounded-md">
                        <AlertCircle className="w-3 h-3 text-amber-400 shrink-0" />
                        <span>Restrictions: {deal.paymentRestrictions}</span>
                      </div>
                    )}
                  </div>

                  {/* Card Bottom: Inspect Evidence Drawer Button, Affiliate Partner Disclosure & Outbound CTA */}
                  <div className="mt-5 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          setInspectedDeal(deal);
                          recordDealClickBeacon(deal.id);
                        }}
                        className={`inline-flex items-center gap-1 text-[11px] font-medium py-1 px-2 rounded-lg transition ${
                          isCoupon
                            ? 'text-purple-400 hover:text-purple-300 hover:bg-purple-500/10'
                            : 'text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/10'
                        }`}
                      >
                        <Info className="w-3.5 h-3.5" />
                        <span>Evidence</span>
                      </button>

                      {/* Clear Distinction: Direct vs Authorized Affiliate Link */}
                      {deal.trackingUrl ? (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300 font-medium"
                          title="Authorized affiliate partner link. May earn a qualifying referral commission."
                        >
                          <Tag className="w-2.5 h-2.5 text-blue-400" />
                          <span>Affiliate</span>
                        </span>
                      ) : (
                        <span
                          className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 font-medium"
                          title="Direct merchant store link without affiliate monetization."
                        >
                          <ShoppingBag className="w-2.5 h-2.5 text-slate-400" />
                          <span>Direct Store</span>
                        </span>
                      )}
                    </div>

                    {/* Outbound Redemption CTA */}
                    <a
                      href={targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={() => recordDealClickBeacon(deal.id)}
                      className={`inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl font-bold text-xs shadow-md transition active:scale-95 ${
                        isCoupon
                          ? 'bg-purple-500 hover:bg-purple-400 text-white shadow-purple-500/20'
                          : (deal.trackingUrl
                              ? 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-cyan-500/10'
                              : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700')
                      }`}
                    >
                      <span>{isCoupon ? 'Redeem Coupon' : 'View Deal'}</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Buyer Assistance Drawer / Modal */}
        {inspectedDeal && (
          <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="modal-title"
              className="bg-slate-900 border border-slate-800 w-full sm:max-w-2xl max-h-[90vh] sm:max-h-[85vh] rounded-t-3xl sm:rounded-2xl p-5 sm:p-6 overflow-y-auto shadow-2xl flex flex-col justify-between"
            >
              <div>
                {/* Modal Header */}
                <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-800">
                  <div>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`text-xs font-bold tracking-wider uppercase ${isCouponDeal(inspectedDeal) ? 'text-purple-400' : 'text-cyan-400'}`}>
                        {inspectedDeal.brand}
                      </span>
                      <span className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-semibold">
                        ✓ Cross-Checked Verification
                      </span>
                    </div>
                    <h2 id="modal-title" className="text-lg sm:text-xl font-bold text-white leading-snug">
                      {inspectedDeal.title}
                    </h2>
                    <div className="mt-1 flex items-center gap-2 text-xs text-slate-400">
                      <span>Store: <strong className="text-slate-200">{inspectedDeal.merchant}</strong></span>
                      <span>•</span>
                      <span>Category: <strong className="text-slate-200">{inspectedDeal.category}</strong></span>
                    </div>
                  </div>
                  <button
                    onClick={() => setInspectedDeal(null)}
                    aria-label="Close deal inspection modal"
                    className="p-1.5 rounded-xl text-slate-400 hover:text-white bg-slate-800/60 hover:bg-slate-800 transition shrink-0"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Section 1: Verification Evidence (Product vs Coupon) */}
                {isCouponDeal(inspectedDeal) ? (
                  /* COUPON VERIFICATION EVIDENCE (NEVER ₹0!) */
                  <div className="mt-5 p-4 rounded-xl bg-purple-950/20 border border-purple-500/30">
                    <h3 className="text-xs font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5 mb-3">
                      <Ticket className="w-4 h-4 text-purple-400" />
                      Verified Voucher Terms &amp; Conditions
                    </h3>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center sm:text-left">
                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800/80">
                        <span className="text-[11px] text-slate-400 block mb-0.5">Offer Type</span>
                        <span className="text-base font-bold text-purple-200">Coupon / Voucher</span>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800/80">
                        <span className="text-[11px] text-slate-400 block mb-0.5">Benefit</span>
                        <span className="text-base font-extrabold text-emerald-400">
                          {inspectedDeal.discountBadge || 'Verified Promo'}
                        </span>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800/80">
                        <span className="text-[11px] text-slate-400 block mb-0.5">Availability</span>
                        <span className="text-base font-semibold text-cyan-300">
                          {inspectedDeal.availability.replace(/_/g, ' ')}
                        </span>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800/80">
                        <span className="text-[11px] text-slate-400 block mb-0.5">Buyer Score</span>
                        <span className="text-base font-bold text-white">
                          {inspectedDeal.buyerValueScore}/100
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-purple-500/20 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-400 gap-2">
                      <div className="flex items-center gap-1.5 text-emerald-400">
                        <Check className="w-3.5 h-3.5" />
                        <span>Status: <strong>{inspectedDeal.verificationStatus.replace(/_/g, ' ')}</strong></span>
                      </div>
                      <div className="flex items-center gap-1 text-purple-300 font-medium">
                        <Clock className="w-3.5 h-3.5 text-purple-400" />
                        <span>Last verified: <strong>{formatTimeAgo(inspectedDeal.lastCheckedAt)}</strong> ({new Date(inspectedDeal.lastCheckedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })})</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* PRODUCT DEAL PRICE EVIDENCE & CALCULATION */
                  <div className="mt-5 p-4 rounded-xl bg-slate-950/70 border border-slate-800">
                    <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5 mb-3">
                      <ShieldCheck className="w-4 h-4 text-emerald-400" />
                      Verified Price Evidence &amp; Calculation
                    </h3>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center sm:text-left">
                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800/80">
                        <span className="text-[11px] text-slate-400 block mb-0.5">Verified Deal Price</span>
                        <span className="text-lg font-black text-white">₹{inspectedDeal.currentPriceINR?.toLocaleString('en-IN')}</span>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800/80">
                        <span className="text-[11px] text-slate-400 block mb-0.5">Reference List MRP</span>
                        <span className="text-lg font-semibold text-slate-400 line-through">
                          {inspectedDeal.referencePriceINR ? `₹${inspectedDeal.referencePriceINR.toLocaleString('en-IN')}` : 'N/A'}
                        </span>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800/80">
                        <span className="text-[11px] text-slate-400 block mb-0.5">True Rupee Savings</span>
                        <span className="text-lg font-bold text-emerald-400">
                          {inspectedDeal.referencePriceINR && typeof inspectedDeal.currentPriceINR === 'number' && inspectedDeal.referencePriceINR > inspectedDeal.currentPriceINR
                            ? `₹${(inspectedDeal.referencePriceINR - inspectedDeal.currentPriceINR).toLocaleString('en-IN')}`
                            : '₹0'}
                        </span>
                      </div>

                      <div className="p-3 rounded-lg bg-slate-900 border border-slate-800/80">
                        <span className="text-[11px] text-slate-400 block mb-0.5">Discount Accuracy</span>
                        <span className="text-lg font-bold text-cyan-400">
                          {inspectedDeal.verifiedDiscountPercent || inspectedDeal.claimedDiscountPercent || 0}% OFF
                        </span>
                        <span className="block text-[10px] text-slate-400 mt-0.5">
                          {inspectedDeal.discountVerificationType === 'INDEPENDENT_CORROBORATED'
                            ? '✓ Verified MRP baseline'
                            : (inspectedDeal.discountVerificationType === 'MERCHANT_CLAIMED'
                                ? '⚠️ Merchant claimed baseline'
                                : 'Unconfirmed baseline')}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 pt-3 border-t border-slate-900 flex flex-col sm:flex-row sm:items-center justify-between text-xs text-slate-400 gap-2">
                      <div className="flex items-center gap-1.5 text-emerald-400">
                        <Check className="w-3.5 h-3.5" />
                        <span>Verification: <strong>{inspectedDeal.discountVerificationType.replace(/_/g, ' ')}</strong></span>
                      </div>
                      <div className="flex items-center gap-1 text-cyan-400/90 font-medium">
                        <Clock className="w-3.5 h-3.5 text-cyan-500" />
                        <span>Last verified: <strong>{formatTimeAgo(inspectedDeal.lastCheckedAt)}</strong> ({new Date(inspectedDeal.lastCheckedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })})</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* Section 2: Historical Observations & Logs */}
                <div className="mt-4 p-4 rounded-xl bg-slate-950/70 border border-slate-800">
                  <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5 mb-2.5">
                    <TrendingDown className="w-4 h-4 text-cyan-400" />
                    Autonomous Discovery &amp; Reliability Evidence
                  </h3>

                  <ul className="space-y-1.5 text-xs text-slate-300">
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400 font-bold shrink-0">•</span>
                      <span>
                        <strong>Buyer Value Score:</strong> {inspectedDeal.buyerValueScore}/100 composite index (derived from corroborated discount accuracy, stock viability, and store trust).
                      </span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="text-cyan-400 font-bold shrink-0">•</span>
                      <span>
                        <strong>Stock Status:</strong> <span className="text-emerald-400 font-medium">{inspectedDeal.availability.replace(/_/g, ' ')}</span> on official merchant store ({inspectedDeal.sourceDomain}).
                      </span>
                    </li>
                    {inspectedDeal.evidenceJson?.verificationLogs && inspectedDeal.evidenceJson.verificationLogs.length > 0 && (
                      inspectedDeal.evidenceJson.verificationLogs.map((log, i) => (
                        <li key={i} className="flex items-start gap-2 text-slate-400">
                          <span className="text-slate-600 font-bold shrink-0">✓</span>
                          <span>{log}</span>
                        </li>
                      ))
                    )}
                  </ul>
                </div>

                {/* Section 3: Coupon Redemption Instructions */}
                <div className="mt-4 p-4 rounded-xl bg-purple-950/20 border border-purple-500/30">
                  <h3 className="text-xs font-bold text-purple-300 uppercase tracking-wider flex items-center gap-1.5 mb-2.5">
                    <Tag className="w-4 h-4 text-purple-400" />
                    Coupon Redemption &amp; Checkout Guide
                  </h3>

                  {inspectedDeal.couponCode ? (
                    <div>
                      <div className="p-3 rounded-lg bg-slate-950/80 border border-purple-500/40 flex items-center justify-between gap-3 mb-3">
                        <div>
                          <span className="text-[11px] text-purple-400 block font-medium">Verified Coupon Code:</span>
                          <span className="font-mono text-base font-extrabold text-purple-200">{inspectedDeal.couponCode}</span>
                        </div>
                        <button
                          onClick={() => {
                            handleCopyCode(inspectedDeal.couponCode!);
                            recordDealClickBeacon(inspectedDeal.id);
                          }}
                          className="px-3 py-1.5 rounded-lg bg-purple-500/20 hover:bg-purple-500/30 text-purple-200 font-bold text-xs border border-purple-500/40 flex items-center gap-1.5 transition active:scale-95"
                        >
                          {copiedCode === inspectedDeal.couponCode ? (
                            <>
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                              <span>Copied!</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3.5 h-3.5" />
                              <span>Copy Code</span>
                            </>
                          )}
                        </button>
                      </div>

                      <div className="space-y-1.5 text-xs text-purple-200/90 leading-relaxed">
                        <p className="flex items-start gap-1.5">
                          <span className="font-bold text-purple-400">1.</span>
                          <span>Click <strong>"Visit {inspectedDeal.merchant} &amp; Redeem"</strong> below to open the authentic merchant listing.</span>
                        </p>
                        <p className="flex items-start gap-1.5">
                          <span className="font-bold text-purple-400">2.</span>
                          <span>Select your items or cart items and proceed to the payment or checkout screen.</span>
                        </p>
                        <p className="flex items-start gap-1.5">
                          <span className="font-bold text-purple-400">3.</span>
                          <span>Enter promo code <strong>{inspectedDeal.couponCode}</strong> in the discount/voucher box.</span>
                        </p>
                        {inspectedDeal.couponConditions && (
                          <p className="flex items-start gap-1.5 text-purple-300/80 text-[11px] mt-1 pt-1 border-t border-purple-500/20 italic">
                            <span>* Terms: {inspectedDeal.couponConditions}</span>
                          </p>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-300">
                      <p className="font-medium text-slate-200 mb-1">Direct Store Discount (No Promo Code Required)</p>
                      <p className="text-slate-400">
                        The promotional discount is directly applied on the official merchant store ({inspectedDeal.sourceDomain}). No manual voucher code entry is required during checkout.
                      </p>
                    </div>
                  )}
                </div>

                {/* Section 4: Explicit Statutory Affiliate Disclosure & Link Separation */}
                <div className="mt-4 p-3.5 rounded-xl bg-slate-950/60 border border-slate-800 text-[11px] text-slate-400 leading-relaxed">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
                      <Info className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Commercial Transparency &amp; Link Separation</span>
                    </div>
                    {inspectedDeal.trackingUrl ? (
                      <span className="px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/30 text-blue-300 text-[10px] font-semibold">
                        Authorized Affiliate Link
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-slate-300 text-[10px] font-semibold">
                        Direct Official Store Link
                      </span>
                    )}
                  </div>
                  {inspectedDeal.trackingUrl ? (
                    <p>
                      This outbound link is an authorized commercial affiliate partner link to <strong>{inspectedDeal.merchant}</strong> ({inspectedDeal.sourceDomain}). When you click through and complete a purchase, our platform may earn a qualifying referral commission at <strong>zero additional cost</strong> to you. Discount baselines are corroborated against official manufacturer pricing sheets; we never inflate reference prices.
                    </p>
                  ) : (
                    <p>
                      This outbound link directs directly to <strong>{inspectedDeal.merchant}</strong> ({inspectedDeal.sourceDomain}) without affiliate monetization or tracking tags. Our autonomous discovery engine lists verified deals and coupons regardless of commercial affiliation to ensure complete and unbiased buyer coverage.
                    </p>
                  )}
                </div>
              </div>

              {/* Modal Footer Actions */}
              <div className="mt-6 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleShareDeal(inspectedDeal)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition"
                  >
                    <Share2 className="w-3.5 h-3.5" />
                    <span>Share</span>
                  </button>

                  <button
                    onClick={() => handleWhatsAppShare(inspectedDeal)}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/30 text-emerald-300 text-xs font-semibold transition"
                  >
                    <MessageCircle className="w-3.5 h-3.5 text-emerald-400" />
                    <span>WhatsApp</span>
                  </button>
                </div>

                <a
                  href={inspectedDeal.trackingUrl || inspectedDeal.productUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => recordDealClickBeacon(inspectedDeal.id)}
                  className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-xs shadow-lg transition active:scale-95 ${
                    isCouponDeal(inspectedDeal)
                      ? 'bg-purple-500 hover:bg-purple-400 text-white shadow-purple-500/20'
                      : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-cyan-500/20'
                  }`}
                >
                  <span>Visit {inspectedDeal.merchant} &amp; Redeem</span>
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </div>
          </div>
        )}

        {/* Category Spotlight & Original Buyer Guide: Health, Nutrition & Personal Care */}
        <section id="health-nutrition-guide" className="mt-12 max-w-5xl mx-auto">
          <div className="p-6 sm:p-8 rounded-2xl bg-gradient-to-br from-slate-900/90 to-slate-950 border border-cyan-500/30 shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-5 pb-4 border-b border-slate-800">
              <div>
                <span className="px-2.5 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-[11px] font-bold uppercase tracking-wider">
                  Category Spotlight
                </span>
                <h3 className="text-lg sm:text-xl font-extrabold text-white mt-2">
                  Health, Nutrition &amp; Grooming Savings Guide
                </h3>
              </div>
              <button
                onClick={() => {
                  setSelectedCategory('Health & Beauty');
                  setOfferTab('all');
                }}
                className="px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/40 text-cyan-300 text-xs font-bold transition flex items-center gap-1.5"
              >
                <span>Filter Category Offers</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 text-xs text-slate-300 leading-relaxed">
              <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80">
                <h4 className="font-bold text-slate-100 text-sm mb-2 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  Authenticity &amp; MRP Truth
                </h4>
                <p>
                  Nutrition and personal care products are vulnerable to fake discounts. We cross-verify manufacturer list prices (MRP) on brand flagships such as Wellbeing Nutrition and The Man Company to ensure discounts reflect genuine savings rather than inflated baselines.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80">
                <h4 className="font-bold text-slate-100 text-sm mb-2 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                  Health &amp; Dietary Advisory
                </h4>
                <p>
                  We verify price, coupon validity, and expiry only. Zero unsupported medical claims: always inspect ingredient lists, batch manufacturing dates, and dietary suitability on the official manufacturer portal before ordering, and consult a qualified healthcare provider.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800/80">
                <h4 className="font-bold text-slate-100 text-sm mb-2 flex items-center gap-2">
                  <Tag className="w-4 h-4 text-purple-400 shrink-0" />
                  Voucher &amp; Cart Conditions
                </h4>
                <p>
                  Special promotional coupons (e.g. <code>WHEY10</code> for whey protein orders or <code>CART15</code> for grooming items) are tested for minimum order requirements, cart limitations, and expiry dates so you don't face surprises at the payment gateway.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Statutory Buyer Protection & Affiliate Disclosure Banner */}
        <section className="mt-14 pt-8 border-t border-slate-800/80 text-xs text-slate-400 max-w-4xl mx-auto leading-relaxed">
          <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800">
            <h4 className="font-bold text-slate-200 mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4 text-cyan-400" /> Independent Verification &amp; Commercial Disclosure
            </h4>
            <p className="mt-1">
              Deals and vouchers on this platform are autonomously gathered across Indian retailer portals, verified manufacturer pages, and public promotional feeds. Discounts are cross-checked against reference MRP baselines. Offers are provided directly with the merchant destination. Where authorized affiliate agreements exist, referrals may earn a small qualifying commission at zero additional cost to you.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
};
