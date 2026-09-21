import React from 'react';
import { ShieldCheck, ArrowLeft, Lock, FileText, UserCheck, AlertTriangle } from 'lucide-react';

export const PrivacyPolicyPage: React.FC<{ onBack?: () => void }> = ({ onBack }) => {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <header className="border-b border-slate-800 bg-slate-900/60 sticky top-0 z-50 backdrop-blur-md px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 flex items-center justify-center font-black">
            SK
          </div>
          <div>
            <h1 className="text-base font-bold text-white">SmileKraft Dental Clinics</h1>
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
            Statutory Compliance: DPDP Act 2023 & Dentists Act 1948
          </div>
          <h2 className="text-3xl font-black text-white tracking-tight">
            Patient Privacy Policy & Statutory Medical Disclosures
          </h2>
          <p className="text-xs text-slate-500 font-mono">
            Effective Date: September 2026 • Policy Version 2026.1 • Jurisdiction: Hyderabad, Telangana, India
          </p>
        </div>

        {/* Section 1: Data Fiduciary Identity */}
        <section className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <Lock className="w-4 h-4 text-cyan-400" />
            1. Identity of Data Fiduciary
          </div>
          <p>
            This Digital Privacy Policy governs personal data processing by <strong>SmileKraft Dental Clinics</strong> (&quot;Data Fiduciary&quot;), operating clinical care facilities in Banjara Hills (Road #12) and Gachibowli (Financial District), Hyderabad, Telangana, under the clinical direction of <strong>Dr. Aravind Reddy, MDS Orthodontics (Telangana State Dental Council Reg: TSDC/2011/58291)</strong>.
          </p>
          <p className="text-xs text-slate-400">
            Designated Grievance Officer: <span className="text-cyan-300">grievance@smilekraftdental.in</span> • Phone: +91 40 2345 6789
          </p>
        </section>

        {/* Section 2: Purpose Limitation */}
        <section className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <FileText className="w-4 h-4 text-cyan-400" />
            2. Purpose Limitation (Section 5 & 6, DPDP Act 2023)
          </div>
          <p>
            When you request an appointment or consultation through our digital portals, we collect only the minimum data necessary:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-300">
            <li><strong>Patient Contact Information:</strong> Full name, mobile phone number, email address (for appointment confirmations and WhatsApp reminders).</li>
            <li><strong>Clinical Intent:</strong> Preferred treatment category (e.g., clear aligners, dental implants) and reported dental symptoms.</li>
            <li><strong>Technical Telemetry:</strong> Anonymized session IDs, referral provenance, and IP address solely for rate limiting and fraud prevention.</li>
          </ul>
          <p className="text-xs text-slate-400">
            We strictly do NOT sell, license, or barter your personal health information to third-party ad brokers or pharmaceutical marketers.
          </p>
        </section>

        {/* Section 3: Right to Erasure */}
        <section className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <UserCheck className="w-4 h-4 text-emerald-400" />
            3. Right to Withdraw Consent & Erasure (Section 12)
          </div>
          <p>
            You have the statutory right to withdraw your consent and request erasure of your personal data at any time. Upon receiving an erasure request via our online portal or by emailing our Grievance Officer:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-300">
            <li>Your contact phone, name, and email are permanently anonymized across active marketing and appointment dispatch tables.</li>
            <li>Financial and billing records (invoices, tax deductions) are retained strictly as required by Indian taxation statutes and Dental Council guidelines.</li>
          </ul>
        </section>

        {/* Section 4: Dental Council of India Code of Ethics */}
        <section className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-3">
          <div className="flex items-center gap-2 text-white font-bold text-base">
            <AlertTriangle className="w-4 h-4 text-amber-400" />
            4. Dental Council of India (DCI) Advertising Ethics Notice
          </div>
          <p>
            Pursuant to the Revised Dentists Act 1948 and the Dental Council of India Code of Ethics Regulations:
          </p>
          <ul className="list-disc pl-5 space-y-1.5 text-xs text-slate-300">
            <li><strong>Informational Nature:</strong> Content on our digital pages is educational and informational. It does NOT constitute a final clinical diagnosis or treatment guarantee.</li>
            <li><strong>No Deceptive Guarantees:</strong> Clinical outcomes in orthodontics and implantology vary based on individual physiological factors, bone density, and compliance. We make zero unconditional &quot;100% painless&quot; or &quot;guaranteed cure&quot; claims.</li>
            <li><strong>Examination Requirement:</strong> Final treatment plan formulation and cost estimates are provided only following an in-person clinical examination and necessary 3D radiographic evaluations.</li>
          </ul>
        </section>
      </main>
    </div>
  );
};
