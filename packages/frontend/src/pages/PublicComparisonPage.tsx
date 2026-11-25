import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Check,
  Copy,
  ExternalLink,
  MessageSquare,
  Send,
  ShieldCheck,
  AlertCircle
} from 'lucide-react';

interface ComparisonDealSide {
  id: string;
  slug: string;
  title: string;
  brand: string;
  merchant: string;
  category: string;
  currentPriceINR: number;
  referencePriceINR: number | null;
  verifiedDiscountPercent: number;
  couponCode: string | null;
  couponConditions: string | null;
  availability: string;
  lastVerifiedAt: string | null;
  targetBuyerSegment: string | null;
  expectedProfitPer100VisitorsINR: number;
  rawSpecs: Record<string, string>;
  rail1RedirectUrl: string;
  rail2AmazonRedirectUrl: string;
  amazonCtaLabel: string;
  disclosure: string;
}

interface RelatedPair {
  comparisonSlug: string;
  title: string;
  category: string;
  priceTierLabel: string;
}

interface ComparisonPayload {
  comparisonSlug: string;
  title: string;
  category: string;
  priceTierLabel: string;
  canonicalUrl: string;
  amazonTagConfigured: boolean;
  disclosure: string;
  dealA: ComparisonDealSide;
  dealB: ComparisonDealSide;
  relatedPairs: RelatedPair[];
}

export const PublicComparisonPage: React.FC = () => {
  const [slug, setSlug] = useState<string>(() => {
    if (typeof window === 'undefined') return '';
    const raw = window.location.pathname.replace(/^\/vs\//, '').replace(/\.html$/, '');
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  });

  const [comparison, setComparison] = useState<ComparisonPayload | null>(null);
  const [fallbackPairs, setFallbackPairs] = useState<RelatedPair[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [notFound, setNotFound] = useState<boolean>(false);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  // Embedded Customer Desk Q&A bound to comparisonSlug
  const [deskInput, setDeskInput] = useState<string>('');
  const [deskLoading, setDeskLoading] = useState<boolean>(false);
  const [deskSessionId, setDeskSessionId] = useState<string>(() => {
    try {
      const existing = localStorage.getItem('aros_desk_sid');
      if (existing) return existing;
      const created = `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      localStorage.setItem('aros_desk_sid', created);
      return created;
    } catch {
      return `web_${Date.now()}`;
    }
  });
  const [deskMessages, setDeskMessages] = useState<Array<{ role: 'user' | 'bot'; text: string; redirectUrl?: string }>>([
    {
      role: 'bot',
      text: 'Ask any question comparing these two verified products (specs, coupon eligibility, warranty, or which fits your budget).'
    }
  ]);

  useEffect(() => {
    const onPop = () => {
      const raw = window.location.pathname.replace(/^\/vs\//, '').replace(/\.html$/, '');
      try {
        setSlug(decodeURIComponent(raw));
      } catch {
        setSlug(raw);
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setNotFound(false);
      try {
        const res = await fetch(`/api/v1/public/comparisons/${encodeURIComponent(slug)}`);
        if (!res.ok) {
          if (!cancelled) setNotFound(true);
          const listRes = await fetch('/api/v1/public/comparisons?limit=6').catch(() => null);
          const listJson = listRes && listRes.ok ? await listRes.json().catch(() => null) : null;
          if (!cancelled && Array.isArray(listJson?.data)) {
            setFallbackPairs(listJson.data);
          }
          return;
        }
        const json = await res.json();
        if (!cancelled && json?.success && json?.data) {
          setComparison(json.data);
          document.title = `${json.data.dealA.title} vs ${json.data.dealB.title} — Price & Spec Comparison`;
        } else if (!cancelled) {
          setNotFound(true);
        }
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    if (slug) {
      load();
      fetch('/api/v1/public/deals/page-view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `/vs/${slug}` })
      }).catch(() => {});
    } else {
      setLoading(false);
      setNotFound(true);
    }

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const handleCopyCoupon = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(code);
      setTimeout(() => setCopiedCode((prev) => (prev === code ? null : prev)), 1800);
    } catch {}
  };

  const handleNavigatePair = (nextSlug: string) => {
    if (typeof window !== 'undefined') {
      window.history.pushState({}, '', `/vs/${encodeURIComponent(nextSlug)}`);
      setSlug(nextSlug);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleAskDesk = async (e: React.FormEvent) => {
    e.preventDefault();
    const msg = deskInput.trim();
    if (!msg || deskLoading) return;
    setDeskInput('');
    setDeskMessages((prev) => [...prev, { role: 'user', text: msg }]);
    setDeskLoading(true);
    try {
      const res = await fetch('/api/v1/customer-desk/message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: msg,
          sessionId: deskSessionId,
          productSlugOrContext: comparison?.comparisonSlug || slug,
          contactChannel: 'WEB_DESK'
        })
      });
      const data = await res.json();
      if (data.sessionId) setDeskSessionId(data.sessionId);
      setDeskMessages((prev) => [
        ...prev,
        {
          role: 'bot',
          text: data.reply || data.error || 'Response unavailable right now.',
          redirectUrl: data.checkout?.redirectUrl || data.checkout?.checkoutUrl
        }
      ]);
    } catch {
      setDeskMessages((prev) => [
        ...prev,
        { role: 'bot', text: 'Customer Desk temporarily unreachable. Please retry shortly.' }
      ]);
    } finally {
      setDeskLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 flex items-center justify-center p-6">
        <div className="text-sm text-slate-400">Loading verified head-to-head comparison...</div>
      </div>
    );
  }

  if (notFound || !comparison) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-200 p-6 md:p-10">
        <div className="max-w-4xl mx-auto space-y-6">
          <a href="/deals" className="inline-flex items-center gap-1.5 text-sm text-cyan-400 hover:text-cyan-300">
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Verified Deals</span>
          </a>

          <div className="p-6 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
            <div className="flex items-center gap-2 text-amber-400 text-sm font-semibold">
              <AlertCircle className="w-4 h-4" />
              <span>Comparison Not Found</span>
            </div>
            <h1 className="text-xl font-bold text-white">No active comparison matches "{slug}"</h1>
            <p className="text-sm text-slate-400">
              One or both products may have rotated out of verified stock. Browse live comparisons or verified deals below.
            </p>
          </div>

          {fallbackPairs.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-bold text-white">Active Verified Comparisons</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {fallbackPairs.map((pair) => (
                  <button
                    key={pair.comparisonSlug}
                    type="button"
                    onClick={() => handleNavigatePair(pair.comparisonSlug)}
                    className="text-left p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors space-y-1"
                  >
                    <div className="text-xs text-slate-400">
                      {pair.category} · {pair.priceTierLabel}
                    </div>
                    <div className="text-sm font-semibold text-cyan-300">{pair.title}</div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const { dealA, dealB } = comparison;
  const specKeys = Array.from(
    new Set([...Object.keys(dealA.rawSpecs || {}), ...Object.keys(dealB.rawSpecs || {})])
  ).slice(0, 12);

  const renderSideCard = (deal: ComparisonDealSide, sideLabel: string) => {
    const hasMrp = Boolean(deal.referencePriceINR && deal.referencePriceINR > deal.currentPriceINR);
    return (
      <div className="p-5 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between gap-5">
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 text-xs text-slate-400">
            <span>{sideLabel} · {deal.merchant}</span>
            <span className="font-mono text-emerald-400">{deal.availability}</span>
          </div>

          <h2 className="text-lg font-bold text-white leading-snug">
            <a
              href={`/deals/${encodeURIComponent(deal.slug)}`}
              className="hover:text-cyan-300 transition-colors"
            >
              {deal.title}
            </a>
          </h2>

          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-3xl font-bold font-mono tabular-nums text-white">
              ₹{Number(deal.currentPriceINR || 0).toLocaleString('en-IN')}
            </span>
            {hasMrp && (
              <span className="text-sm font-mono tabular-nums text-slate-500 line-through">
                MRP ₹{Number(deal.referencePriceINR).toLocaleString('en-IN')}
              </span>
            )}
            {deal.verifiedDiscountPercent > 0 && (
              <span className="text-xs font-mono tabular-nums font-bold text-emerald-400">
                {deal.verifiedDiscountPercent}% OFF
              </span>
            )}
          </div>

          <div className="text-xs text-slate-400 space-y-1">
            {deal.targetBuyerSegment && (
              <div>
                <span className="text-slate-500">Best for:</span>{' '}
                <span className="text-slate-200">{deal.targetBuyerSegment}</span>
              </div>
            )}
            <div className="font-mono text-[11px] text-slate-500">
              Verified snapshot: {deal.lastVerifiedAt ? new Date(deal.lastVerifiedAt).toLocaleString('en-IN') : 'Recent merchant check'}
            </div>
          </div>

          {deal.couponCode && (
            <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs">
              <span className="text-slate-300">
                Promo Code: <code className="font-mono font-bold text-cyan-300">{deal.couponCode}</code>
              </span>
              <button
                type="button"
                onClick={() => handleCopyCoupon(deal.couponCode!)}
                className="inline-flex items-center gap-1 text-slate-300 hover:text-white font-medium"
              >
                {copiedCode === deal.couponCode ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-400" />
                    <span className="text-emerald-400">Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copy</span>
                  </>
                )}
              </button>
            </div>
          )}
        </div>

        {/* Dual-Rail Cuelinks + Amazon.in Associates CTAs */}
        <div className="space-y-2 pt-2 border-t border-slate-800">
          <a
            href={deal.rail1RedirectUrl}
            target="_blank"
            rel="sponsored nofollow noopener noreferrer"
            className="w-full py-2.5 px-4 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm inline-flex items-center justify-center gap-2 transition-colors"
          >
            <span>Buy at {deal.merchant} →</span>
            <ExternalLink className="w-4 h-4" />
          </a>
          <a
            href={deal.rail2AmazonRedirectUrl}
            target="_blank"
            rel="sponsored nofollow noopener noreferrer"
            className="w-full py-2 px-3 rounded-lg bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/35 text-amber-300 font-semibold text-xs inline-flex items-center justify-center gap-1.5 transition-colors text-center"
          >
            <span>Check Today&apos;s Live Price &amp; Prime Coupons on Amazon.in → (#Ad)</span>
          </a>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      {/* Top Bar */}
      <header className="border-b border-slate-800 bg-slate-950/90 sticky top-0 z-20 backdrop-blur">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
          <a
            href="/deals"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-300 hover:text-white whitespace-nowrap"
          >
            <ArrowLeft className="w-4 h-4 text-cyan-400" />
            <span>Verified Deals Catalog</span>
          </a>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span className="hidden sm:inline font-mono">#Ad · Dual-Rail Verified Comparison</span>
            <a href="/public/disclosure" className="hover:text-white whitespace-nowrap">Disclosure</a>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-8">
        {/* Heading & Metadata */}
        <div className="space-y-2 border-b border-slate-800 pb-6">
          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
            <span className="text-cyan-400 font-semibold">Head-to-Head Comparison</span>
            <span aria-hidden="true">·</span>
            <span>{comparison.category}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono">{comparison.priceTierLabel}</span>
            <span aria-hidden="true">·</span>
            <span>#Ad</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            {dealA.title} vs {dealB.title}
          </h1>
          <p className="text-sm text-slate-400 max-w-3xl">
            Side-by-side verified D2C pricing, promo codes, technical specifications, and instant live price checks on Amazon.in.
          </p>
        </div>

        {/* Dual Product Comparison Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {renderSideCard(dealA, 'Option A')}
          {renderSideCard(dealB, 'Option B')}
        </div>

        {/* Side-by-Side Comparison Matrix */}
        <section className="rounded-xl bg-slate-900 border border-slate-800 overflow-hidden">
          <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-bold text-white">Verified Specs &amp; Price Matrix</h2>
            <span className="text-xs text-slate-400 inline-flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Snapshot verified · Zero fabricated Amazon prices</span>
            </span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-800 bg-slate-950/60 text-slate-400">
                  <th className="py-3 px-4 font-medium w-1/4">Attribute</th>
                  <th className="py-3 px-4 font-semibold text-white w-[37.5%]">{dealA.title}</th>
                  <th className="py-3 px-4 font-semibold text-white w-[37.5%]">{dealB.title}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                <tr>
                  <td className="py-3 px-4 text-slate-400 font-medium">Verified D2C Price</td>
                  <td className="py-3 px-4 font-mono tabular-nums font-bold text-emerald-400">
                    ₹{Number(dealA.currentPriceINR || 0).toLocaleString('en-IN')}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums font-bold text-emerald-400">
                    ₹{Number(dealB.currentPriceINR || 0).toLocaleString('en-IN')}
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-4 text-slate-400 font-medium">Reference List MRP</td>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-300">
                    {dealA.referencePriceINR && dealA.referencePriceINR > dealA.currentPriceINR
                      ? `₹${dealA.referencePriceINR.toLocaleString('en-IN')} (${dealA.verifiedDiscountPercent}% off)`
                      : 'Verified Direct'}
                  </td>
                  <td className="py-3 px-4 font-mono tabular-nums text-slate-300">
                    {dealB.referencePriceINR && dealB.referencePriceINR > dealB.currentPriceINR
                      ? `₹${dealB.referencePriceINR.toLocaleString('en-IN')} (${dealB.verifiedDiscountPercent}% off)`
                      : 'Verified Direct'}
                  </td>
                </tr>
                <tr>
                  <td className="py-3 px-4 text-slate-400 font-medium">Merchant &amp; Brand</td>
                  <td className="py-3 px-4 text-slate-200">{dealA.merchant} ({dealA.brand || 'Verified'})</td>
                  <td className="py-3 px-4 text-slate-200">{dealB.merchant} ({dealB.brand || 'Verified'})</td>
                </tr>
                <tr>
                  <td className="py-3 px-4 text-slate-400 font-medium">Target Buyer</td>
                  <td className="py-3 px-4 text-slate-300">{dealA.targetBuyerSegment || 'General Indian Value Buyer'}</td>
                  <td className="py-3 px-4 text-slate-300">{dealB.targetBuyerSegment || 'General Indian Value Buyer'}</td>
                </tr>
                {specKeys.map((k) => (
                  <tr key={k}>
                    <td className="py-3 px-4 text-slate-400 font-medium capitalize">{k.replace(/_/g, ' ')}</td>
                    <td className="py-3 px-4 text-slate-200">{dealA.rawSpecs?.[k] || '—'}</td>
                    <td className="py-3 px-4 text-slate-200">{dealB.rawSpecs?.[k] || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Embedded Customer Desk Q&A */}
        <section className="rounded-xl bg-slate-900 border border-slate-800 p-5 space-y-4">
          <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-cyan-400" />
              <h2 className="text-sm font-bold text-white">24/7 Verified Buyer Concierge</h2>
            </div>
            <span className="text-xs text-slate-400 font-mono">Context: {comparison.comparisonSlug}</span>
          </div>

          <div className="space-y-2.5 max-h-60 overflow-y-auto pr-1">
            {deskMessages.map((m, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-lg text-xs leading-relaxed ${
                  m.role === 'user'
                    ? 'bg-cyan-950/50 border border-cyan-500/30 text-cyan-100 ml-8'
                    : 'bg-slate-950 border border-slate-800 text-slate-200 mr-8'
                }`}
              >
                <div>{m.text}</div>
                {m.redirectUrl && (
                  <a
                    href={m.redirectUrl}
                    target="_blank"
                    rel="sponsored nofollow noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-emerald-400 hover:text-emerald-300 font-semibold"
                  >
                    <span>Proceed to Verified Merchant →</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            ))}
          </div>

          <form onSubmit={handleAskDesk} className="flex gap-2">
            <input
              type="text"
              value={deskInput}
              onChange={(e) => setDeskInput(e.target.value)}
              placeholder={`Ask which is better between ${dealA.brand || dealA.merchant} and ${dealB.brand || dealB.merchant}...`}
              className="flex-1 px-3 py-2 rounded-lg bg-slate-950 border border-slate-700 text-sm text-white placeholder-slate-500"
            />
            <button
              type="submit"
              disabled={deskLoading || !deskInput.trim()}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-semibold inline-flex items-center gap-1.5 shrink-0"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{deskLoading ? 'Checking...' : 'Ask'}</span>
            </button>
          </form>
        </section>

        {/* Related Comparisons */}
        {comparison.relatedPairs.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-sm font-bold text-white">More Head-to-Head Comparisons</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {comparison.relatedPairs.map((rp) => (
                <button
                  key={rp.comparisonSlug}
                  type="button"
                  onClick={() => handleNavigatePair(rp.comparisonSlug)}
                  className="text-left p-4 rounded-xl bg-slate-900 border border-slate-800 hover:border-slate-700 transition-colors space-y-1"
                >
                  <div className="text-[11px] text-slate-400">
                    {rp.category} · {rp.priceTierLabel}
                  </div>
                  <div className="text-xs font-semibold text-cyan-300 line-clamp-2">{rp.title}</div>
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Statutory Affiliate Disclosure */}
        <footer className="rounded-xl bg-slate-900/60 border border-slate-800 p-4 text-xs text-slate-400 leading-relaxed">
          <strong className="text-slate-200">#Ad Statutory Affiliate Disclosure:</strong> {comparison.disclosure}
        </footer>
      </main>
    </div>
  );
};
