import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  MapPin,
  MessageCircle,
  ShieldCheck,
  Sparkles
} from 'lucide-react';
import { api } from '../services/api.js';

type Offering = {
  id?: string;
  title: string;
  description?: string;
  priceINR?: number;
  targetSegment?: string;
};

type PublicBusiness = {
  id: string;
  public_slug?: string;
  name: string;
  vertical_name: string;
  country: string;
  currency: string;
  timezone: string;
  city: string;
  neighborhood: string;
  website_url?: string | null;
  phone?: string | null;
  primary_language?: string;
  secondary_languages?: string[];
  value_propositions?: string[];
  offerings?: Offering[];
};

function cleanIntent(value: string | null): string {
  return (value || '')
    .replace(/\s+/g, ' ')
    .replace(/[<>`]/g, '')
    .trim()
    .slice(0, 100);
}

function getRouteParts() {
  if (typeof window === 'undefined') {
    return { businessId: '', funnelSlug: '' };
  }

  const parts = window.location.pathname
    .split('/')
    .filter(Boolean)
    .map((p) => decodeURIComponent(p));

  const markerIndex = parts[0] === 'f' || parts[0] === 'book' ? 1 : 0;

  return {
    businessId: parts[markerIndex] || '',
    funnelSlug: parts[markerIndex + 1] || 'default'
  };
}

function parseOfferings(raw: any): Offering[] {
  try {
    const parsed =
      Array.isArray(raw?.offerings) ? raw.offerings :
      typeof raw?.offerings_json === 'string' ? JSON.parse(raw.offerings_json) :
      [];

    if (!Array.isArray(parsed)) return [];

    return parsed.map((o: any) => ({
      id: o.id,
      title: String(o.title || o.name || 'General enquiry'),
      description: o.description ? String(o.description) : '',
      priceINR: typeof o.priceINR === 'number' ? o.priceINR : undefined,
      targetSegment: o.targetSegment ? String(o.targetSegment) : ''
    }));
  } catch {
    return [];
  }
}

export const UniversalFunnelPage: React.FC = () => {
  const { businessId: routeBusinessId, funnelSlug } = getRouteParts();
  const searchParams = new URLSearchParams(
    typeof window !== 'undefined' ? window.location.search : ''
  );

  const businessId =
    routeBusinessId ||
    searchParams.get('businessId') ||
    searchParams.get('biz') ||
    searchParams.get('businessSlug') ||
    '';

  const intentFromQuery = cleanIntent(
    searchParams.get('intent') ||
    searchParams.get('q') ||
    searchParams.get('keyword') ||
    searchParams.get('utm_term')
  );

  const [business, setBusiness] = useState<PublicBusiness | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [submitted, setSubmitted] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [need, setNeed] = useState(intentFromQuery);
  const [selectedOffer, setSelectedOffer] = useState('');
  const [location, setLocation] = useState('');
  const [notes, setNotes] = useState('');
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!businessId) {
        setLoadError('This funnel URL is missing a business identifier.');
        setLoading(false);
        return;
      }

      try {
        const res: any = await api.getPublicBusiness(businessId);
        if (!res?.data?.id) {
          throw new Error('Business profile not found.');
        }

        if (cancelled) return;

        const nextBusiness = res.data as PublicBusiness;
        setBusiness(nextBusiness);

        const offers = parseOfferings(nextBusiness);

        if (offers.length > 0) {
          setSelectedOffer((current) => current || offers[0].title);
        }

        setLocation((current) => current || (
          nextBusiness.neighborhood
            ? `${nextBusiness.neighborhood}${nextBusiness.city ? `, ${nextBusiness.city}` : ''}`
            : nextBusiness.city || ''
        ));
      } catch (e: any) {
        if (!cancelled) {
          setLoadError(e?.message || 'Could not load this business funnel.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
    };
  }, [businessId]);

  const offerings = useMemo(() => parseOfferings(business), [business]);

  const headline = intentFromQuery
    ? `Get the right solution for “${intentFromQuery}”`
    : `Tell ${business?.name || 'the business'} what you need`;

  async function submitLead(event: React.FormEvent) {
    event.preventDefault();
    setSubmitError('');

    if (!consent) {
      setSubmitError('Please accept the contact and service-request consent to continue.');
      return;
    }

    setSubmitting(true);

    try {
      const payload = {
        businessId: business?.id,
        businessSlug: business?.public_slug || undefined,
        customerName: name.trim(),
        customerPhone: phone.trim(),
        customerEmail: email.trim() || undefined,
        serviceOfInterest: selectedOffer || need.trim() || 'General enquiry',
        channel: searchParams.get('utm_source') ? 'PAID_ORGANIC_FUNNEL' : 'PUBLIC_FUNNEL',
        source: searchParams.get('utm_source') || searchParams.get('utm_medium') || `funnel:${funnelSlug}`,
        campaignId: searchParams.get('campaignId') || searchParams.get('campaign_id') || undefined,
        sessionId: `sess_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        gclid: searchParams.get('gclid') || undefined,
        fbclid: searchParams.get('fbclid') || undefined,
        intent: need.trim() || intentFromQuery || undefined,
        funnelSlug,
        landingPage:
          typeof window !== 'undefined'
            ? window.location.pathname
            : `/f/${businessId}/${funnelSlug}`,
        location: location.trim() || undefined,
        notes: notes.trim() || undefined,
        utmSource: searchParams.get('utm_source') || undefined,
        utmMedium: searchParams.get('utm_medium') || undefined,
        utmCampaign: searchParams.get('utm_campaign') || undefined,
        utmTerm: searchParams.get('utm_term') || undefined,
        utmContent: searchParams.get('utm_content') || undefined,
        consentGiven: true,
        dpdpConsentGiven: business?.country === 'IN',
        website_url_hp: honeypot
      };

      const res: any = await api.post('/public/lead', payload);

      if (!res?.success) {
        throw new Error(res?.error || 'Lead submission failed.');
      }

      setSubmitted(res.data);
    } catch (e: any) {
      setSubmitError(e?.message || 'Unable to submit your request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center">
        <div className="text-center space-y-3">
          <div className="mx-auto h-10 w-10 rounded-full border-2 border-slate-700 border-t-cyan-400 animate-spin" />
          <div className="text-sm text-slate-300">Loading your request page…</div>
        </div>
      </div>
    );
  }

  if (loadError || !business) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-rose-500/30 bg-slate-900 p-7 text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-rose-400 mx-auto" />
          <h1 className="text-lg font-bold">Funnel unavailable</h1>
          <p className="text-sm text-slate-400">
            {loadError || 'The requested business is not configured for public enquiries.'}
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 px-5 py-12">
        <div className="max-w-xl mx-auto rounded-3xl border border-emerald-500/30 bg-slate-900 p-8 shadow-2xl">
          <div className="w-14 h-14 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-5">
            <CheckCircle2 className="w-7 h-7 text-emerald-400" />
          </div>

          <h1 className="text-2xl font-black text-center">Request received</h1>

          <p className="text-center text-slate-400 text-sm mt-2">
            {business.name} has received your request.
            {submitted.leadId ? (
              <> Your reference is <span className="text-cyan-300 font-mono">{submitted.leadId}</span>.</>
            ) : null}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-7 text-sm">
            <div className="rounded-xl bg-slate-950 border border-slate-800 p-4">
              <div className="text-slate-500 text-xs">Need</div>
              <div className="font-semibold mt-1">{need || 'General enquiry'}</div>
            </div>

            <div className="rounded-xl bg-slate-950 border border-slate-800 p-4">
              <div className="text-slate-500 text-xs">Market</div>
              <div className="font-semibold mt-1">{business.city || 'Local market'}</div>
            </div>
          </div>

          {business.phone && (
            <a
              href={`tel:${business.phone}`}
              className="mt-7 w-full py-3 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold flex items-center justify-center gap-2"
            >
              <MessageCircle className="w-4 h-4" />
              Contact {business.name}
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <div className="border-b border-cyan-900/50 bg-slate-950/95 sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-5 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-cyan-300 text-sm font-bold">
            <Sparkles className="w-4 h-4" />
            <span>{business.name}</span>
          </div>
          <div className="text-xs text-slate-500">{business.vertical_name}</div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-5 py-10 grid lg:grid-cols-[1.05fr_.95fr] gap-8">
        <section className="space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-cyan-500/10 border border-cyan-500/20 text-cyan-300 text-xs font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            Direct request channel
          </div>

          <h1 className="text-4xl sm:text-5xl font-black tracking-tight leading-tight">
            {headline}
          </h1>

          <p className="text-base sm:text-lg text-slate-400 max-w-2xl">
            Share what you are trying to solve. This page uses the business profile,
            your stated need, and campaign context to route the enquiry to the relevant
            offer instead of forcing every visitor through an industry-specific page.
          </p>

          <div className="grid sm:grid-cols-2 gap-3">
            {(business.value_propositions || []).slice(0, 4).map((v, i) => (
              <div key={`${v}-${i}`} className="rounded-2xl bg-slate-900 border border-slate-800 p-4">
                <div className="text-xs text-cyan-300 font-semibold">Why this business</div>
                <div className="text-sm text-slate-200 mt-1">{v}</div>
              </div>
            ))}
          </div>

          <div className="rounded-2xl bg-slate-900 border border-slate-800 p-5 space-y-3">
            <div className="text-xs uppercase tracking-widest text-slate-500">Context captured</div>

            <div className="flex flex-wrap gap-2 text-xs">
              {intentFromQuery && (
                <span className="px-2.5 py-1 rounded-full bg-cyan-500/10 text-cyan-300">
                  Intent: {intentFromQuery}
                </span>
              )}

              <span className="px-2.5 py-1 rounded-full bg-slate-800 text-slate-300">
                Funnel: {funnelSlug}
              </span>

              {searchParams.get('utm_source') && (
                <span className="px-2.5 py-1 rounded-full bg-slate-800 text-slate-300">
                  Source: {searchParams.get('utm_source')}
                </span>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-3xl bg-slate-900/90 border border-slate-800 p-6 sm:p-8 shadow-2xl">
          <form onSubmit={submitLead} className="space-y-4">
            <div>
              <h2 className="text-xl font-bold">Tell us what you need</h2>
              <p className="text-xs text-slate-500 mt-1">
                No industry-specific assumptions. Describe the actual outcome you want.
              </p>
            </div>

            {submitError && (
              <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 p-3 text-xs flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{submitError}</span>
              </div>
            )}

            <div className="grid sm:grid-cols-2 gap-3">
              <input
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Full name"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-3 text-sm outline-none focus:border-cyan-500"
              />

              <input
                required
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Phone / WhatsApp"
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-3 text-sm outline-none focus:border-cyan-500"
              />
            </div>

            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email (optional)"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-3 text-sm outline-none focus:border-cyan-500"
            />

            {offerings.length > 0 && (
              <select
                value={selectedOffer}
                onChange={(e) => setSelectedOffer(e.target.value)}
                className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-3 text-sm outline-none focus:border-cyan-500"
              >
                {offerings.map((offer) => (
                  <option key={`${offer.id || offer.title}`} value={offer.title}>
                    {offer.title}
                    {business.currency === 'INR' && typeof offer.priceINR === 'number'
                      ? ` — ₹${offer.priceINR.toLocaleString('en-IN')}`
                      : ''}
                  </option>
                ))}
              </select>
            )}

            <textarea
              rows={4}
              value={need}
              onChange={(e) => setNeed(e.target.value)}
              placeholder="What are you trying to achieve? Include your exact requirement, budget range, urgency, or preferred service."
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-3 text-sm outline-none focus:border-cyan-500 resize-y"
            />

            <div className="grid sm:grid-cols-2 gap-3">
              <div className="relative">
                <MapPin className="w-4 h-4 text-slate-600 absolute left-3 top-3.5" />
                <input
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="City / area"
                  className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3 py-3 text-sm outline-none focus:border-cyan-500"
                />
              </div>

              <div className="flex items-center gap-2 rounded-xl bg-slate-950 border border-slate-700 px-3 text-xs text-slate-400">
                <Clock3 className="w-4 h-4 shrink-0" />
                We use the stated need and campaign context to route the enquiry.
              </div>
            </div>

            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything else we should know? (optional)"
              className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-3 text-sm outline-none focus:border-cyan-500 resize-y"
            />

            <div className="hidden" aria-hidden="true">
              <input
                tabIndex={-1}
                autoComplete="off"
                value={honeypot}
                onChange={(e) => setHoneypot(e.target.value)}
              />
            </div>

            <label className="flex items-start gap-2.5 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                I agree that {business.name} may use the contact details above to respond to
                this request and provide relevant information about the selected service.
              </span>
            </label>

            <button
              disabled={submitting}
              className="w-full py-3.5 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {submitting ? 'Submitting request…' : 'Get the right next step'}
              <ArrowRight className="w-4 h-4" />
            </button>

            <p className="text-[11px] text-slate-600 text-center">
              Business location: {business.city}{business.neighborhood ? ` • ${business.neighborhood}` : ''}
              {business.timezone ? ` • ${business.timezone}` : ''}
            </p>
          </form>

          <div className="mt-6 pt-5 border-t border-slate-800 text-[11px] text-slate-600 leading-relaxed">
            This is a general-purpose demand-capture surface. Product availability,
            pricing, timelines and service suitability are determined by the business.
            The system records campaign context for attribution and operational follow-up.
          </div>
        </section>
      </main>
    </div>
  );
};
