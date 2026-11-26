import React, { useState, useEffect } from 'react';
import {
  FileText,
  CheckCircle2,
  Copy,
  ShieldCheck,
  Globe,
  ExternalLink
} from 'lucide-react';
import { INDIAN_LANGUAGES } from '@ai-marketing/shared';
import { api } from '../services/api.js';

interface ContentStudioProps {
  contentAssets: any[];
  business?: any;
}

export const ContentStudio: React.FC<ContentStudioProps> = ({ contentAssets, business: propBusiness }) => {
  const [selectedLanguage, setSelectedLanguage] = useState<string>('ALL');
  const [selectedChannel, setSelectedChannel] = useState<string>('ALL');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [liveDeals, setLiveDeals] = useState<any[]>([]);
  const [comparisons, setComparisons] = useState<any[]>([]);
  const [buyerGuides, setBuyerGuides] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      api.getPublicDeals(8).catch(() => null),
      api.getPublicComparisons(6).catch(() => null),
      api.getPublicBuyerGuides(6).catch(() => null)
    ]).then(([dealsRes, cmpRes, guideRes]) => {
      const rawDeals = dealsRes?.deals ?? dealsRes?.data?.deals ?? dealsRes?.data;
      setLiveDeals(Array.isArray(rawDeals) ? rawDeals : []);
      const rawComparisons = cmpRes?.comparisons ?? cmpRes?.data?.comparisons ?? cmpRes?.data;
      setComparisons(Array.isArray(rawComparisons) ? rawComparisons : []);
      const rawGuides = guideRes?.guides ?? guideRes?.data?.guides ?? guideRes?.data;
      setBuyerGuides(Array.isArray(rawGuides) ? rawGuides : []);
    });
  }, []);

  const channels = ['ALL', 'INSTAGRAM', 'TELEGRAM', 'EMAIL', 'SEO_COMPARISON', 'BUYER_GUIDE'];

  const activeBiz = propBusiness || (() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('ai_marketing_active_business');
        if (stored) return JSON.parse(stored);
      } catch {}
    }
    return null;
  })();

  const bizName = activeBiz?.name || 'Single-Owner Catalog';

  // Convert live verified deals, /vs/ comparisons, and /best/ buyer guides into ready copyable distribution assets
  const liveDistributionAssets = [
    ...liveDeals
      .filter((d: any) => Boolean(d?.slug || d?.id))
      .map((d: any, idx: number) => {
        const dealSlug = String(d.slug || d.id);
        const price = Math.round(Number(d.dealPriceINR || d.currentPriceINR || 0));
        const ytLine = d.youtubeReview?.videoUrl ? `\nReview Video: ${d.youtubeReview.videoUrl}` : '';
        return {
          id: `deal_ig_${dealSlug}_${idx}`,
          title: d.title,
          channel: 'INSTAGRAM',
          language: 'English',
          content: `#Ad Verified Fair-Price Offer: ${d.title}\nLive Price: ₹${price.toLocaleString('en-IN')} on ${d.merchant}${ytLine}\nComment "DEAL" or visit /ig for tracked Store + Amazon.in check links.`,
          call_to_action: `${window.location.origin}/deals/${encodeURIComponent(dealSlug)}`,
          status: d.youtubeReview?.videoUrl ? 'YOUTUBE_ENRICHED' : 'LIVE_DEAL',
          externalUrl: `/deals/${encodeURIComponent(dealSlug)}`
        };
      }),
    ...comparisons
      .filter((c: any) => Boolean(c?.comparisonSlug || c?.slug))
      .map((c: any, idx: number) => {
        const cmpSlug = String(c.comparisonSlug || c.slug);
        return {
          id: `cmp_${cmpSlug}_${idx}`,
          title: c.title || `${c.productA} vs ${c.productB}`,
          channel: 'SEO_COMPARISON',
          language: 'English',
          content: c.summary || `Head-to-head Indian pricing comparison: ${c.title}`,
          call_to_action: `${window.location.origin}/vs/${encodeURIComponent(cmpSlug)}`,
          status: 'PUBLISHED_VS_PAGE',
          externalUrl: `/vs/${encodeURIComponent(cmpSlug)}`
        };
      }),
    ...buyerGuides
      .filter((g: any) => Boolean(g?.intentSlug || g?.slug))
      .map((g: any, idx: number) => {
        const guideSlug = String(g.intentSlug || g.slug);
        return {
          id: `guide_${guideSlug}_${idx}`,
          title: g.title || guideSlug,
          channel: 'BUYER_GUIDE',
          language: 'English',
          content: g.intro || `Curated buyer guide for ${g.title || guideSlug}`,
          call_to_action: `${window.location.origin}/best/${encodeURIComponent(guideSlug)}`,
          status: 'PUBLISHED_GUIDE',
          externalUrl: `/best/${encodeURIComponent(guideSlug)}`
        };
      })
  ];

  const baseAssets = [...(contentAssets || []), ...liveDistributionAssets];

  const filteredAssets = baseAssets.filter(asset => {
    const matchesLang = selectedLanguage === 'ALL' || asset.language === selectedLanguage;
    const matchesChan = selectedChannel === 'ALL' || asset.channel === selectedChannel;
    return matchesLang && matchesChan;
  });

  const handleCopy = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-extrabold text-white flex items-center gap-2">
            <FileText className="w-5 h-5 text-cyan-400" />
            Content Studio &amp; Public SEO Asset Library
          </h2>
          <p className="text-slate-400 text-xs mt-1">
            Live Deal Posts (with #Ad &amp; YouTube Reviews), published /vs/ comparisons, and /best/ buyer guides for <strong className="text-cyan-300">{bizName}</strong>.
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs font-mono tabular-nums text-slate-300">
          <span>{liveDeals.length} Live Deals</span>
          <span aria-hidden="true">·</span>
          <span>{comparisons.length} /vs/ Pages</span>
          <span aria-hidden="true">·</span>
          <span>{buyerGuides.length} /best/ Guides</span>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-xl bg-slate-900 border border-slate-800">
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400 font-semibold">Channel:</span>
          <div className="flex flex-wrap gap-1">
            {channels.map(ch => (
              <button
                key={ch}
                onClick={() => setSelectedChannel(ch)}
                className={`px-2.5 py-1 rounded text-xs font-semibold transition-all ${
                  selectedChannel === ch
                    ? 'bg-cyan-500 text-slate-950 font-bold'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                {ch}
              </button>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-slate-400" />
          <select
            value={selectedLanguage}
            onChange={(e) => setSelectedLanguage(e.target.value)}
            className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
          >
            <option value="ALL">All Languages</option>
            {INDIAN_LANGUAGES.map(lang => (
              <option key={lang.code} value={lang.name}>
                {lang.name} ({lang.nativeName})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Assets Grid */}
      {filteredAssets.length === 0 ? (
        <div className="p-12 text-center rounded-xl bg-slate-900 border border-slate-800 space-y-2">
          <p className="text-sm font-semibold text-slate-300">No live content assets matched filters</p>
          <p className="text-xs text-slate-500">
            Run Trigger 1 Live Harvest Cycle on Overview or adjust channel/language filters above.
          </p>
          <button
            onClick={() => { setSelectedChannel('ALL'); setSelectedLanguage('ALL'); }}
            className="mt-3 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-cyan-400 transition"
          >
            Reset Filters
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredAssets.map((asset: any) => (
            <div key={asset.id} className="p-5 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between space-y-4">
              <div>
                <div className="flex items-center justify-between mb-2 text-[11px] font-mono">
                  <div className="text-cyan-400">
                    <span>{asset.channel}</span>
                    <span aria-hidden="true"> · </span>
                    <span className="text-slate-400">{asset.language || 'English'}</span>
                  </div>
                  <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                    <ShieldCheck className="w-3.5 h-3.5" />
                    {asset.status || 'PUBLISHED'}
                  </span>
                </div>

                <h3 className="font-bold text-sm text-slate-100 mb-2">{asset.title}</h3>

                <div className="p-3.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-300 whitespace-pre-line leading-relaxed">
                  {asset.content}
                </div>

                {asset.call_to_action && (
                  <div className="mt-3 p-2.5 rounded bg-slate-950 border border-slate-800 text-xs flex items-center justify-between gap-2">
                    <span className="text-slate-400 shrink-0">Destination:</span>
                    <span className="font-mono text-cyan-400 truncate">{asset.call_to_action}</span>
                  </div>
                )}
              </div>

              <div className="pt-3 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
                {asset.externalUrl ? (
                  <a
                    href={asset.externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-cyan-400 hover:underline inline-flex items-center gap-1"
                  >
                    <span>Open Live Page</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                ) : (
                  <span className="text-slate-500">Workspace Asset</span>
                )}

                <button
                  onClick={() => handleCopy(asset.id, asset.content)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold transition-all"
                >
                  {copiedId === asset.id ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy Post</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};