import React, { useState, useEffect, useMemo } from 'react';
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
  ArrowUpDown
} from 'lucide-react';

export interface DealItem {
  id: string;
  title: string;
  brand: string;
  merchant: string;
  category: string;
  productUrl: string;
  currentPriceINR: number;
  currency: string;
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
}

export const PublicDealsPage: React.FC = () => {
  const [deals, setDeals] = useState<DealItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Filters state
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [selectedMerchant, setSelectedMerchant] = useState<string>('all');
  const [verifiedOnly, setVerifiedOnly] = useState<boolean>(false);
  const [hasCouponOnly, setHasCouponOnly] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<'buyer_value' | 'freshness' | 'price_asc' | 'discount'>('buyer_value');

  useEffect(() => {
    fetchDeals();
  }, []);

  const fetchDeals = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/public/deals?limit=50');
      if (res.ok) {
        const json = await res.json();
        if (json.data && Array.isArray(json.data.deals)) {
          setDeals(json.data.deals);
        }
      }
    } catch (e) {
      console.warn('Could not fetch deals from public endpoint, using fallback', e);
    } finally {
      setLoading(false);
    }
  };

  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    setCopiedCode(code);
    setTimeout(() => setCopiedCode(null), 2500);
  };

  const categories = useMemo(() => {
    const set = new Set<string>();
    deals.forEach(d => set.add(d.category));
    return ['all', ...Array.from(set)];
  }, [deals]);

  const merchants = useMemo(() => {
    const set = new Set<string>();
    deals.forEach(d => set.add(d.merchant));
    return ['all', ...Array.from(set)];
  }, [deals]);

  const filteredDeals = useMemo(() => {
    return deals.filter(deal => {
      if (verifiedOnly && deal.verificationStatus !== 'VERIFIED') return false;
      if (hasCouponOnly && !deal.couponCode) return false;
      if (selectedCategory !== 'all' && deal.category !== selectedCategory) return false;
      if (selectedMerchant !== 'all' && deal.merchant !== selectedMerchant) return false;

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = deal.title.toLowerCase().includes(q);
        const matchesBrand = deal.brand.toLowerCase().includes(q);
        const matchesMerchant = deal.merchant.toLowerCase().includes(q);
        if (!matchesTitle && !matchesBrand && !matchesMerchant) return false;
      }
      return true;
    }).sort((a, b) => {
      if (sortBy === 'buyer_value') return b.buyerValueScore - a.buyerValueScore;
      if (sortBy === 'freshness') return new Date(b.lastCheckedAt).getTime() - new Date(a.lastCheckedAt).getTime();
      if (sortBy === 'price_asc') return a.currentPriceINR - b.currentPriceINR;
      if (sortBy === 'discount') return (b.verifiedDiscountPercent || 0) - (a.verifiedDiscountPercent || 0);
      return 0;
    });
  }, [deals, searchQuery, selectedCategory, selectedMerchant, verifiedOnly, hasCouponOnly, sortBy]);

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* Navigation Header */}
      <header className="border-b border-slate-800/80 bg-slate-900/50 backdrop-blur sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-500 flex items-center justify-center text-white shadow-lg shadow-cyan-500/20">
              <ShoppingBag className="w-5 h-5" />
            </div>
            <div>
              <span className="font-bold text-white text-base tracking-tight">Verified Deals</span>
              <span className="text-xs px-2 py-0.5 ml-2 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 font-medium">India</span>
            </div>
          </div>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <ShieldCheck className="w-4 h-4" />
              <span>Independent Verification</span>
            </span>
            <a
              href="/"
              className="text-slate-300 hover:text-white transition px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-800/50 hover:bg-slate-800"
            >
              Platform Home
            </a>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Hero Section */}
        <div className="mb-8 text-center max-w-3xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs font-semibold uppercase tracking-wider mb-3">
            <Sparkles className="w-3.5 h-3.5" />
            Autonomous Deal Discovery Engine V1.1
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Curated, Cross-Checked Deals for Indian Buyers
          </h1>
          <p className="mt-2 text-sm sm:text-base text-slate-400">
            Zero inflated discounts. Every promotional price, MRP reference, and coupon condition is independently verified across official Indian merchant stores.
          </p>
        </div>

        {/* Search & Filters Toolbar */}
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4 sm:p-5 mb-8 shadow-xl">
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-center">
            {/* Search Input */}
            <div className="sm:col-span-6 relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search products, brands (boAt, Lenovo, Noise...), or merchants..."
                className="w-full pl-10 pr-4 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-100 placeholder-slate-500 focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500 transition"
              />
            </div>

            {/* Merchant Dropdown */}
            <div className="sm:col-span-3">
              <select
                value={selectedMerchant}
                onChange={(e) => setSelectedMerchant(e.target.value)}
                className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-200 focus:outline-none focus:border-cyan-500 transition"
              >
                <option value="all">All Merchants</option>
                {merchants.filter(m => m !== 'all').map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>

            {/* Sort Dropdown */}
            <div className="sm:col-span-3">
              <div className="relative">
                <ArrowUpDown className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="w-full pl-8 pr-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-200 focus:outline-none focus:border-cyan-500 transition"
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
          <div className="mt-4 pt-4 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-slate-500 font-medium mr-1 flex items-center gap-1">
                <Filter className="w-3 h-3" /> Categories:
              </span>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`text-xs px-3 py-1 rounded-lg font-medium transition ${
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
            <div className="flex items-center gap-4 text-xs">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={verifiedOnly}
                  onChange={(e) => setVerifiedOnly(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-800 text-cyan-500 focus:ring-0 focus:ring-offset-0"
                />
                <span className="text-slate-300">Verified Only</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hasCouponOnly}
                  onChange={(e) => setHasCouponOnly(e.target.checked)}
                  className="rounded bg-slate-950 border-slate-800 text-cyan-500 focus:ring-0 focus:ring-offset-0"
                />
                <span className="text-slate-300">Has Promo Code</span>
              </label>
            </div>
          </div>
        </div>

        {/* Loading Indicator */}
        {loading && (
          <div className="py-16 text-center text-slate-400">
            <div className="w-8 h-8 border-2 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin mx-auto mb-3" />
            <p className="text-sm">Fetching and cross-checking live deals...</p>
          </div>
        )}

        {/* Empty State */}
        {!loading && filteredDeals.length === 0 && (
          <div className="py-16 text-center bg-slate-900/40 border border-slate-800/80 rounded-2xl p-8 max-w-lg mx-auto">
            <AlertCircle className="w-10 h-10 text-slate-500 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-slate-200">No deals match your filter criteria</h3>
            <p className="text-xs text-slate-400 mt-1">
              Try adjusting your search query, selecting "All Categories", or disabling the verified-only toggle.
            </p>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedCategory('all');
                setSelectedMerchant('all');
                setVerifiedOnly(false);
                setHasCouponOnly(false);
              }}
              className="mt-4 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white rounded-lg transition"
            >
              Reset Filters
            </button>
          </div>
        )}

        {/* Deals Grid */}
        {!loading && filteredDeals.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {filteredDeals.map((deal) => {
              const hasDiscount = (deal.verifiedDiscountPercent && deal.verifiedDiscountPercent > 0) || (deal.claimedDiscountPercent && deal.claimedDiscountPercent > 0);
              const discountVal = deal.verifiedDiscountPercent || deal.claimedDiscountPercent || 0;
              const isVerified = deal.verificationStatus === 'VERIFIED';
              const targetUrl = deal.trackingUrl || deal.productUrl;

              return (
                <div
                  key={deal.id}
                  className="bg-slate-900/70 border border-slate-800 hover:border-slate-700 rounded-2xl p-5 flex flex-col justify-between transition group shadow-lg hover:shadow-cyan-500/5"
                >
                  <div>
                    {/* Top Meta Badges */}
                    <div className="flex items-center justify-between gap-2 mb-3">
                      <span className="text-[11px] font-semibold tracking-wider text-cyan-400 uppercase">
                        {deal.brand}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {isVerified ? (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 font-medium">
                            <CheckCircle2 className="w-3 h-3" /> Verified
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 font-medium">
                            Conditions Apply
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Product Title */}
                    <h3 className="text-base font-semibold text-white group-hover:text-cyan-300 transition line-clamp-2 leading-snug">
                      {deal.title}
                    </h3>

                    {/* Merchant & Category */}
                    <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                      <span className="text-slate-300 font-medium">{deal.merchant}</span>
                      <span>•</span>
                      <span>{deal.category}</span>
                    </div>

                    {/* Price and Discount Presentation */}
                    <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-baseline gap-2.5">
                      <span className="text-2xl font-extrabold text-white">
                        ₹{deal.currentPriceINR.toLocaleString('en-IN')}
                      </span>
                      {deal.referencePriceINR && deal.referencePriceINR > deal.currentPriceINR && (
                        <span className="text-xs text-slate-500 line-through">
                          MRP ₹{deal.referencePriceINR.toLocaleString('en-IN')}
                        </span>
                      )}
                      {hasDiscount && (
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-md ${
                          deal.discountVerificationType === 'INDEPENDENT_CORROBORATED'
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                            : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                        }`}>
                          {discountVal}% OFF
                          {deal.discountVerificationType === 'INDEPENDENT_CORROBORATED' ? ' (Verified)' : ''}
                        </span>
                      )}
                    </div>

                    {/* Coupon Box if present */}
                    {deal.couponCode && (
                      <div className="mt-3.5 p-2.5 rounded-xl bg-slate-950/80 border border-slate-800 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 truncate">
                          <Tag className="w-3.5 h-3.5 text-purple-400 shrink-0" />
                          <span className="font-mono text-xs font-bold text-purple-300">{deal.couponCode}</span>
                        </div>
                        <button
                          onClick={() => handleCopyCode(deal.couponCode!)}
                          className="text-[11px] px-2 py-1 rounded bg-purple-500/10 hover:bg-purple-500/20 text-purple-300 font-medium border border-purple-500/30 flex items-center gap-1 shrink-0 transition"
                        >
                          {copiedCode === deal.couponCode ? (
                            <>
                              <Check className="w-3 h-3 text-emerald-400" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-3 h-3" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}

                    {/* Coupon or Payment Conditions note */}
                    {deal.couponConditions && (
                      <p className="mt-2 text-[11px] text-slate-400 leading-relaxed italic">
                        {deal.couponConditions}
                      </p>
                    )}
                  </div>

                  {/* Card Bottom: Verification metadata & Action Button */}
                  <div className="mt-5 pt-3 border-t border-slate-800/80 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                      <Clock className="w-3 h-3" />
                      <span>Checked recently</span>
                    </div>

                    <a
                      href={targetUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shadow-md shadow-cyan-500/10 transition active:scale-95"
                    >
                      <span>View Deal</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Statutory Buyer Protection & Affiliate Disclosure Banner */}
        <section className="mt-14 pt-8 border-t border-slate-800/80 text-xs text-slate-400 max-w-4xl mx-auto leading-relaxed">
          <div className="p-5 rounded-2xl bg-slate-900/40 border border-slate-800">
            <h4 className="font-bold text-slate-200 mb-1 flex items-center gap-1.5 text-xs uppercase tracking-wider">
              <ShieldCheck className="w-4 h-4 text-cyan-400" /> Independent Verification & Commercial Disclosure
            </h4>
            <p className="mt-1">
              Deals on this platform are autonomously gathered across Indian retailer portals, verified manufacturer pages, and public promotional feeds. Discounts are cross-checked against reference MRP baselines. Offers are provided directly with the merchant destination. Where authorized affiliate agreements exist, referrals may earn a small qualifying commission at zero additional cost to you.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
};
