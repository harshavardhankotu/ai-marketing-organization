import React, { useState } from 'react';

export const PublicOfferPage: React.FC = () => {
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [clinicName, setClinicName] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');
  const [challengeNotes, setChallengeNotes] = useState('');

  // Submission state
  const [status, setStatus] = useState<'IDLE' | 'SENDING' | 'RETRYING' | 'SUCCESS' | 'ERROR'>('IDLE');
  const [message, setMessage] = useState('');

  // Interactive audit calculator state
  const [monthlyInquiries, setMonthlyInquiries] = useState<number>(80);
  const [afterHoursPercent, setAfterHoursPercent] = useState<number>(40);

  // WhatsApp click-to-chat: Strictly owner-configured, NO DEFAULT
  const ownerWhatsappNumber = (
    (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env.VITE_OWNER_WHATSAPP_NUMBER) ||
    (typeof window !== 'undefined' && (window as any).__OWNER_WHATSAPP_NUMBER__) ||
    ''
  ).trim();

  // Audit calculator derived metrics (Strictly NO rupee estimates)
  const estimatedAfterHoursAtRisk = Math.round((monthlyInquiries * afterHoursPercent) / 100);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!customerName.trim() || !customerPhone.trim()) {
      setStatus('ERROR');
      setMessage('Name and mobile number are required.');
      return;
    }

    const payload = {
      customerName: customerName.trim(),
      customerPhone: customerPhone.trim(),
      customerEmail: customerEmail.trim() || undefined,
      practiceName: clinicName.trim() || customerName.trim(),
      notes: challengeNotes.trim() || undefined
    };

    const apiUrl = '/api/v1/offer/inquiry';

    // Helper with 25s timeout
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
    setMessage('Submitting your inquiry... (waking up server if idle)');

    try {
      const data = await sendRequest();
      setStatus('SUCCESS');
      setMessage(data.message || 'Inquiry received successfully! Our team will contact you shortly.');
    } catch (err: any) {
      // First attempt failed (possibly cold start timeout) -> Retry ONCE
      console.warn('[OfferPage] First submission failed, retrying once for cold API:', err.message);
      setStatus('RETRYING');
      setMessage('Server is waking up. Retrying submission automatically...');

      try {
        await new Promise(r => setTimeout(r, 2000));
        const retryData = await sendRequest();
        setStatus('SUCCESS');
        setMessage(retryData.message || 'Inquiry received successfully on retry!');
      } catch (retryErr: any) {
        setStatus('ERROR');
        setMessage(`Submission could not be completed: ${retryErr.message}. Please try again in a few moments.`);
      }
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans p-4 sm:p-8">
      <div className="max-w-3xl mx-auto space-y-8">
        {/* Header */}
        <header className="text-center space-y-3 pt-6">
          <div className="inline-block bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
            Architecture Overview & Triage
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold text-white tracking-tight">
            AI Inbound Lead Conversion System
          </h1>
          <p className="text-slate-400 max-w-xl mx-auto text-sm sm:text-base leading-relaxed">
            Automated inquiry triage, rapid qualification, and appointment scheduling architecture for local service practices in India.
          </p>
        </header>

        {/* The Problem Card */}
        <section className="bg-slate-900/80 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-4 shadow-xl">
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
            The Problem: Inquiries Falling Through The Cracks
          </h2>
          <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
            Local service businesses lose prospective clients every day when inquiries arrive outside working hours. When high-intent prospective customers reach out via online profiles or WhatsApp in the evening, responses often wait until the next morning — by which time they have already contacted a competitor.
          </p>
          <p className="text-slate-400 text-sm leading-relaxed">
            Our automated inquiry triage architecture qualifies new inquiries within minutes and coordinates calendar appointments without manual messaging delay.
          </p>
        </section>

        {/* Audit Calculator (Strictly NO rupee estimates) */}
        <section className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
          <h2 className="text-lg font-bold text-white">Interactive After-Hours Lead Audit Calculator</h2>
          <p className="text-xs text-slate-400">
            Adjust the sliders below to estimate the volume of patient/client inquiries at risk outside business hours:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Estimated Monthly Inquiries: <span className="text-cyan-400 font-bold">{monthlyInquiries}</span>
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
                Inquiries Received After-Hours: <span className="text-cyan-400 font-bold">{afterHoursPercent}%</span>
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
              <div className="text-xs text-slate-400 mt-1">Inquiries at Risk / Month</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-emerald-400">&lt; 2 mins</div>
              <div className="text-xs text-slate-400 mt-1">Target Automated Triage SLA</div>
            </div>
          </div>
        </section>

        {/* Request Triage Demonstration Form */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-6 sm:p-8 space-y-6 shadow-xl">
          <div>
            <h2 className="text-xl font-bold text-white">Request System Walkthrough & Demonstration</h2>
            <p className="text-xs sm:text-sm text-slate-400 mt-1">
              Submit your practice details for a confidential system demonstration and architecture walkthrough.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Doctor / Contact Name *</label>
                <input
                  type="text"
                  required
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="Dr. Rajesh Sharma"
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
                  placeholder="9876543210"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Clinic / Practice Name & City *</label>
                <input
                  type="text"
                  required
                  value={clinicName}
                  onChange={e => setClinicName(e.target.value)}
                  placeholder="Apex Dental Clinic, Hyderabad"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Email Address (Optional)</label>
                <input
                  type="email"
                  value={customerEmail}
                  onChange={e => setCustomerEmail(e.target.value)}
                  placeholder="contact@practice.com"
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Primary Inquiry Challenge (e.g. evening patient calls, WhatsApp FAQ automation)
              </label>
              <textarea
                rows={2}
                value={challengeNotes}
                onChange={e => setChallengeNotes(e.target.value)}
                placeholder="Patients reaching out after 8 PM wait until next morning. Want instant qualification."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <button
              type="submit"
              disabled={status === 'SENDING' || status === 'RETRYING'}
              className="w-full py-3 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:bg-slate-800 text-white font-semibold text-sm transition-all shadow-lg shadow-cyan-600/20"
            >
              {status === 'SENDING' && 'Submitting inquiry... (waking up server)'}
              {status === 'RETRYING' && 'Retrying connection...'}
              {status !== 'SENDING' && status !== 'RETRYING' && 'Request Lead Triage Demonstration'}
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

        {/* WhatsApp Click-to-Chat (rendered strictly if owner configured, NO DEFAULT) */}
        {ownerWhatsappNumber && (
          <div className="text-center">
            <a
              href={`https://wa.me/${ownerWhatsappNumber.replace(/\D/g, '')}?text=Hello%2C%20I%20would%20like%20to%20learn%20more%20about%20the%20AI%20Inbound%20Lead%20Conversion%20System.`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold px-5 py-2.5 rounded-xl text-sm transition-all shadow-lg shadow-emerald-600/20"
            >
              💬 Chat directly on WhatsApp with Platform Owner
            </a>
          </div>
        )}

        {/* Footer with legal navigation */}
        <footer className="text-center pt-8 border-t border-slate-800 text-xs text-slate-500 space-y-2">
          <div className="flex justify-center gap-4">
            <a href="/privacy" className="hover:text-slate-400">Privacy Policy</a>
            <span>•</span>
            <a href="/terms" className="hover:text-slate-400">Terms of Service</a>
            <span>•</span>
            <a href="/about" className="hover:text-slate-400">About</a>
            <span>•</span>
            <a href="/contact" className="hover:text-slate-400">Contact</a>
          </div>
          <p>© {new Date().getFullYear()} AI Marketing Organization. Technical Overview Page.</p>
        </footer>
      </div>
    </div>
  );
};
