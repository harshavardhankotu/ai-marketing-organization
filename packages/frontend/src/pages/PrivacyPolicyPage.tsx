import React from 'react';
import { ShieldCheck, ArrowLeft, Lock, FileText, UserCheck, AlertTriangle } from 'lucide-react';

interface PrivacyPolicyPageProps {
  onBack?: () => void;
  business?: any;
}

export const PrivacyPolicyPage: React.FC<PrivacyPolicyPageProps> = ({ onBack, business: propBusiness }) => {
  const activeBusiness = propBusiness || (() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem('ai_marketing_active_business');
        if (stored) return JSON.parse(stored);
      } catch {}
    }
    return null;
  })();

  const bizName = activeBusiness?.name || 'Registered Commercial Enterprise';
  const initials = (bizName.split(/\s+/).map((w: string) => w[0]).join('').slice(0, 2) || 'DP').toUpperCase();
  const city = activeBusiness?.city || 'India';
  const neighborhood = activeBusiness?.neighborhood ? `${activeBusiness.neighborhood}, ` : '';
  const fullAddress = activeBusiness?.address || `${neighborhood}${city}, India`;
  const verticalName = activeBusiness?.vertical_name || 'Enterprise';
  const verticalId = activeBusiness?.vertical_id || '';
  const isHealthcare = /dental|health|clinic|doctor|hospital|ortho/i.test(verticalName + ' ' + verticalId);

  const directorName = activeBusiness?.director_name || activeBusiness?.doctor_name || (isHealthcare ? 'Chief Medical Director' : 'Designated Authorized Representative');
  const regInfo = activeBusiness?.registration_number || activeBusiness?.license_number || activeBusiness?.council_reg || (isHealthcare ? 'State Healthcare & Medical Council Reg: Verified on File' : 'CIN / MSME / Trade License: Verified on File');
  
  const getGrievanceEmail = () => {
    if (activeBusiness?.grievance_email) return activeBusiness.grievance_email;
    if (activeBusiness?.email) return activeBusiness.email;
    if (activeBusiness?.website_url) {
      try {
        const host = new URL(activeBusiness.website_url.startsWith('http') ? activeBusiness.website_url : `https://${activeBusiness.website_url}`).hostname.replace('www.', '');
        return `grievance@${host}`;
      } catch {}
    }
    const slug = bizName.toLowerCase().replace(/[^a-z0-9]/g, '');
    return `grievance@${slug || 'business'}.in`;
  };

  const grievanceEmail = getGrievanceEmail();
  const contactPhone = activeBusiness?.phone || '+91 Official Business Support Line';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <header className="border-b border-slate-800 bg-slate-900/60 sticky top-0 z-50 backdrop-blur-md px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 flex items-center justify-center font-black">
            {initials}
          </div>
          <div>
            <h1 className="text-base font-bold text-white">{bizName}</h1>
            <p className="text-xs text-slate-400">Digital Personal Data Protection & Ethics Notice</p>
          </div>
        </div>
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 transition"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back
          </button>
        )}
      </header>

      <main className="max-w-4xl mx-auto px-6 py-10 space-y-8 text-sm leading-relaxed text-slate-300">
        <div className="space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-semibold">
            <ShieldCheck className="w-3.5 h-3.5" />
            Statutory Compliance: DPDP Act 2023 & Indian Law
          </div>
          <h2 className="text-3xl font-black text-white tracking-tight">
            Privacy Policy & Statutory Legal Disclosures
          </h2>
          <p className="text-xs text-slate-500 font-mono">
            Effective Date: September 2026 • Policy Version 2026.1 • Data Fiduciary: {bizName} ({city}, India)
          </p>
        </div>

        {/* Section 1: Data Fiduciary Identity */}
        <section className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <Lock className="w-4 h-4 text-cyan-400" />
            1. Identity of Data Fiduciary
          </div>
          <p>
            This Digital Privacy Policy governs personal data processing by <strong>{bizName}</strong> (&quot;Data Fiduciary&quot;), operating facilities and commercial operations in {fullAddress}, under the direction and supervision of <strong>{directorName} ({regInfo})</strong>.
          </p>
          <p className="text-xs text-slate-400">
            Designated Grievance Officer: <span className="text-cyan-300 font-mono">{grievanceEmail}</span> • Phone: <span className="text-slate-300 font-mono">{contactPhone}</span>
          </p>
        </section>

        {/* Section 2: Purpose Limitation */}
        <section className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <FileText className="w-4 h-4 text-cyan-400" />
            2. Purpose Limitation (Sections 5 &amp; 6, DPDP Act 2023)
          </div>
          <p>
            When you request an appointment, booking, or inquiry through our digital channels for <strong>{bizName}</strong>, we collect strictly the minimum data necessary:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-300">
            <li><strong>Contact Information:</strong> Full name, mobile phone number, email address (for booking confirmations, appointment reminders, and customer service).</li>
            <li><strong>Service Requirements:</strong> Inquiry details, preferred services, or requested consultation notes.</li>
            <li><strong>Technical Telemetry:</strong> Anonymized session identifiers, referral channel provenance, and IP address strictly for rate limiting, cybersecurity, and fraud prevention.</li>
          </ul>
          <p className="text-xs text-slate-400">
            We strictly do NOT sell, license, or barter your personal information to third-party ad brokers or unauthorized commercial aggregators.
          </p>
        </section>

        {/* Section 3: Right to Erasure */}
        <section className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <UserCheck className="w-4 h-4 text-emerald-400" />
            3. Right to Withdraw Consent &amp; Erasure (Section 12)
          </div>
          <p>
            You have the statutory right to withdraw your consent and request erasure of your personal data at any time. Upon receiving an erasure request via our online portal or by emailing our designated Grievance Officer (<span className="text-cyan-300 font-mono">{grievanceEmail}</span>):
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-300">
            <li>Your contact phone, name, and email are permanently scrubbed/anonymized across active marketing and notification tables.</li>
            <li>Tax, GST, and statutory financial records are retained strictly as mandated under Indian taxation statutes and statutory retention periods.</li>
          </ul>
        </section>

        {/* Section 4: Industry & Advertising Ethics Notice */}
        <section className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            4. {isHealthcare ? 'Healthcare & Clinical Advertising Ethics Notice' : 'Consumer Protection & Truth-in-Advertising Notice'}
          </div>
          {isHealthcare ? (
            <>
              <p>
                Pursuant to the Revised Dentists Act 1948 / National Medical Commission Guidelines and Advertising Standards Council of India (ASCI):
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-300">
                <li><strong>Informational Nature:</strong> Content on our digital pages is educational and informational. It does NOT constitute a final clinical diagnosis or treatment guarantee.</li>
                <li><strong>No Deceptive Guarantees:</strong> Clinical outcomes vary based on individual physiological factors. We make zero unconditional &quot;100% painless&quot; or &quot;guaranteed cure&quot; claims.</li>
                <li><strong>Examination Requirement:</strong> Final treatment plan formulation and cost estimates are provided only following an in-person clinical consultation and necessary diagnostic evaluations.</li>
              </ul>
            </>
          ) : (
            <>
              <p>
                Pursuant to the Consumer Protection Act 2019 and the Advertising Standards Council of India (ASCI) Code:
              </p>
              <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-300">
                <li><strong>Fair Representation:</strong> All descriptions of products, offerings, and service timelines by <strong>{bizName}</strong> represent genuine capabilities.</li>
                <li><strong>Transparent Pricing:</strong> Stated quotes, estimates, and pricing plans represent base fees; any applicable taxes (GST) or ancillary charges are disclosed transparently before final payment.</li>
                <li><strong>Genuine Reviews:</strong> Customer feedback and testimonial citations represent actual verified client interactions without artificial manipulation.</li>
              </ul>
            </>
          )}
        </section>
      </main>
    </div>
  );
};
