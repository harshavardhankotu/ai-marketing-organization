import React, { useEffect, useState } from 'react';

export const PublicOfferPage: React.FC = () => {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [instituteName, setInstituteName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [challengeNotes, setChallengeNotes] = useState('');
  const [consentGiven, setConsentGiven] = useState(false);

  // Submission state
  const [status, setStatus] = useState<'IDLE' | 'SENDING' | 'RETRYING' | 'SUCCESS' | 'ERROR'>('IDLE');
  const [message, setMessage] = useState('');

  // Interactive audit calculator state (Strictly NO rupee estimates)
  const [monthlyInquiries, setMonthlyInquiries] = useState<number>(80);
  const [afterHoursPercent, setAfterHoursPercent] = useState<number>(40);

  // WhatsApp click-to-chat: Strictly owner-configured, NO DEFAULT
  const ownerWhatsappNumber = (
    (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.VITE_OWNER_WHATSAPP_NUMBER) ||
    (typeof window !== 'undefined' && (window as any).__OWNER_WHATSAPP_NUMBER__) ||
    ''
  ).trim();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = 'Founding Pilot — Website Enquiry Path Repair | AI Marketing Organization';
    const desc =
      'Website Enquiry Path Repair for training institutes in Hyderabad and India. Founding Pilot ₹1,999 (₹999 advance + ₹1,000 after live handover, 7-day bug-fix window).';
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute('content', desc);
    const canonicalUrl = `${window.location.origin}/offer`;
    let canonicalLink = document.querySelector('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.setAttribute('href', canonicalUrl);
  }, []);

  const estimatedAfterHoursAtRisk = Math.round((monthlyInquiries * afterHoursPercent) / 100);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim() || !customerPhone.trim()) {
      setStatus('ERROR');
      setMessage('Name and mobile number are required.');
      return;
    }
    if (!consentGiven) {
      setStatus('ERROR');
      setMessage('Please confirm consent to submit your enquiry.');
      return;
    }

    const payload = {
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      customerEmail: customerEmail.trim() || undefined,
      serviceOfInterest: instituteName.trim() || customerName.trim(),
      notes: challengeNotes.trim() || undefined,
      consentGiven: true,
      source: 'offer_page_inquiry',
      channel: 'WHATSAPP'
    };

    const apiUrl = '/api/v1/offer/inquiry';

    const sendRequest = async () => {
      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(25000)
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Server returned HTTP ${res.status}: ${text}`);
      }
      return res.json();
    };

    setStatus('SENDING');
    setMessage('Submitting your enquiry... (waking up server if idle)');

    try {
      const data = await sendRequest();
      setStatus('SUCCESS');
      setMessage(data.message || 'Enquiry received successfully! Our team will contact you shortly.');
    } catch (err: any) {
      setStatus('RETRYING');
      setMessage('Server is waking up. Retrying submission automatically...');

      try {
        await new Promise(r => setTimeout(r, 2000));
        const retryData = await sendRequest();
        setStatus('SUCCESS');
        setMessage(retryData.message || 'Enquiry received successfully on retry!');
      } catch (retryErr: any) {
        setStatus('ERROR');
        setMessage(`Submission could not be completed: ${retryErr.message}. Please try again in a few moments.`);
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <nav className="border-b border-slate-800 bg-slate-950/95 sticky top-0 z-30 backdrop-blur">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <a href="/" className="font-extrabold text-sm text-white whitespace-nowrap">
            AI Marketing Org
          </a>
          <div className="flex items-center gap-4 text-xs font-semibold text-slate-400">
            <a href="/" className="hover:text-cyan-400 whitespace-nowrap">Home</a>
            <a href="/demo" className="hover:text-cyan-400 whitespace-nowrap">Live Demo</a>
            <a href="/offer" className="text-cyan-400 whitespace-nowrap">Founding Pilot</a>
            <a href="/contact" className="hover:text-cyan-400 whitespace-nowrap">Contact</a>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto p-4 sm:p-8 space-y-8">
        <header className="text-center space-y-3 pt-4">
          <div className="inline-block bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
            Hyderabad &bull; Founder-Led Founding Pilot
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            Website Enquiry Path Repair for Training Institutes
          </h1>
          <p className="text-slate-400 max-w-xl mx-auto text-sm sm:text-base leading-relaxed">
            Mobile-first admissions enquiry forms, pre-filled WhatsApp click-to-chat routing, and structured lead tracking &mdash; ₹1,999 Founding Pilot (₹999 advance + ₹1,000 after live handover, 7-day bug-fix window).
          </p>
          <div className="pt-2">
            <a
              href="/demo"
              className="inline-flex items-center gap-2 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold px-5 py-2.5 rounded-xl text-sm transition-colors"
            >
              Try Live Interactive Demo &rarr;
            </a>
          </div>
        </header>

        <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4 shadow-xl">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
            Why Training Institutes Lose Mobile Enquiries
          </h2>
          <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
            Prospective students browsing course pages on mobile often hit broken contact forms, tiny phone links, or unmonitored evening channels. Without a structured enquiry path, high-intent batch enquiries slip away before a counsellor calls back.
          </p>
          <p className="text-slate-400 text-sm leading-relaxed">
            We repair your mobile enquiry flow, wire direct WhatsApp course pre-fill links, and connect a clean lead status tracker with zero recurring SaaS fees.
          </p>
        </section>

        <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">Interactive After-Hours Enquiry Volume Estimator</h2>
          <p className="text-xs text-slate-400">
            Adjust the sliders below to estimate how many monthly admissions enquiries arrive outside office hours:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Estimated Monthly Student Enquiries: <span className="text-cyan-400 font-bold">{monthlyInquiries}</span>
              </label>
              <input
                type="range"
                min={20}
                max={500}
                step={10}
                value={monthlyInquiries}
                onChange={e => setMonthlyInquiries(Number(e.target.value))}
                className="w-full accent-cyan-500 cursor-pointer"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Enquiries Received After-Hours: <span className="text-cyan-400 font-bold">{afterHoursPercent}%</span>
              </label>
              <input
                type="range"
                min={10}
                max={80}
                step={5}
                value={afterHoursPercent}
                onChange={e => setAfterHoursPercent(Number(e.target.value))}
                className="w-full accent-cyan-500 cursor-pointer"
              />
            </div>
          </div>
          <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 grid grid-cols-2 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-amber-400">{estimatedAfterHoursAtRisk}</div>
              <div className="text-xs text-slate-400 mt-1">After-Hours Enquiries / Month</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-400">30 sec</div>
              <div className="text-xs text-slate-400 mt-1">Mobile Form + WhatsApp Path</div>
            </div>
          </div>
        </section>

        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xl">
          <div>
            <h2 className="text-xl font-bold text-white">Request Founding Pilot Setup</h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Submit your institute details for a direct walkthrough and scope confirmation.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Founder / Counsellor Name *</label>
                <input
                  type="text"
                  required
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="e.g. Kiran Reddy"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">WhatsApp / Mobile Number *</label>
                <input
                  type="tel"
                  required
                  value={customerPhone}
                  onChange={e => setCustomerPhone(e.target.value)}
                  placeholder="9849012345"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Training Institute Name &amp; City *</label>
                <input
                  type="text"
                  required
                  value={instituteName}
                  onChange={e => setInstituteName(e.target.value)}
                  placeholder="e.g. Pragati Coaching Academy, Hyderabad"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Email Address (Optional)</label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={e => setCustomerEmail(e.target.value)}
                  placeholder="founder@institute.in"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Website URL or Current Enquiry Bottleneck
              </label>
              <textarea
                rows={2}
                value={challengeNotes}
                onChange={e => setChallengeNotes(e.target.value)}
                placeholder="e.g. Mobile admissions form throws errors; students struggle to reach WhatsApp."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <label className="flex items-start gap-2 text-xs text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={consentGiven}
                onChange={e => setConsentGiven(e.target.checked)}
                required
                className="mt-0.5"
              />
              <span>
                I consent to be contacted regarding this Founding Pilot enquiry under the{' '}
                <a href="/privacy" className="text-cyan-400 underline">Privacy Policy</a>.
              </span>
            </label>

            <button
              type="submit"
              disabled={status === 'SENDING' || status === 'RETRYING'}
              className="w-full py-3 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 text-white font-semibold text-sm transition-all shadow-lg shadow-cyan-600/20"
            >
              {status === 'SENDING' && 'Submitting enquiry... (waking up server)'}
              {status === 'RETRYING' && 'Retrying connection...'}
              {status !== 'SENDING' && status !== 'RETRYING' && 'Request Founding Pilot Walkthrough'}
            </button>

            {message && (
              <div className={`p-3 rounded-lg text-xs text-center ${
                status === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/30' :
                status === 'ERROR' ? 'bg-rose-500/10 text-rose-300 border border-rose-500/30' :
                'bg-cyan-500/10 text-cyan-300 border border-cyan-500/30'
              }`}>
                {message}
              </div>
            )}
          </form>
        </section>

        {ownerWhatsappNumber && (
          <div className="text-center">
            <a
              href={`https://wa.me/${ownerWhatsappNumber.replace(/\D/g, '')}?text=Hello%2C%20I%20would%20like%20to%20discuss%20the%20Founding%20Pilot%20for%20Website%20Enquiry%20Path%20Repair.`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-all shadow-lg shadow-emerald-600/20"
            >
              Chat directly on WhatsApp with Founder
            </a>
          </div>
        )}

        <footer className="text-center pt-8 border-t border-slate-800 text-xs text-slate-500 space-y-2">
          <div className="flex flex-wrap justify-center gap-4">
            <a href="/terms" className="hover:text-slate-300">Terms</a>
            <span>&bull;</span>
            <a href="/privacy" className="hover:text-slate-300">Privacy Policy</a>
            <span>&bull;</span>
            <a href="/refund" className="hover:text-slate-300">Refund Policy</a>
            <span>&bull;</span>
            <a href="/contact" className="hover:text-slate-300">Contact</a>
          </div>
          <p>&copy; {new Date().getFullYear()} AI Marketing Organization &bull; Hyderabad, India</p>
        </footer>
      </div>
    </div>
  );
};
