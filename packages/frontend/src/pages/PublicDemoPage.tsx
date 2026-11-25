import React, { useEffect, useState } from 'react';

type LeadStage = 'New' | 'Contacted' | 'Demo Scheduled' | 'Enrolled';

interface SampleLeadRow {
  id: string;
  studentName: string;
  course: string;
  phoneMasked: string;
  stage: LeadStage;
  source: string;
}

const STAGES: LeadStage[] = ['New', 'Contacted', 'Demo Scheduled', 'Enrolled'];

const INITIAL_SAMPLE_LEADS: SampleLeadRow[] = [
  {
    id: 'demo-101',
    studentName: 'Ananya R. (Sample)',
    course: 'Full-Stack Web Cohort',
    phoneMasked: '+91 98*** **210',
    stage: 'Demo Scheduled',
    source: 'Mobile Form'
  },
  {
    id: 'demo-102',
    studentName: 'Karthik M. (Sample)',
    course: 'Data Analytics Bootcamp',
    phoneMasked: '+91 97*** **418',
    stage: 'Contacted',
    source: 'WhatsApp CTA'
  },
  {
    id: 'demo-103',
    studentName: 'Sneha P. (Sample)',
    course: 'UPSC / State PSC Foundation',
    phoneMasked: '+91 99*** **604',
    stage: 'New',
    source: 'Mobile Form'
  }
];

export const PublicDemoPage: React.FC = () => {
  const [studentName, setStudentName] = useState('');
  const [studentPhone, setStudentPhone] = useState('');
  const [selectedCourse, setSelectedCourse] = useState('Full-Stack Web Cohort');
  const [preferredBatch, setPreferredBatch] = useState('Evening Batch (7 PM)');
  const [submittedSample, setSubmittedSample] = useState<{
    sampleId: string;
    studentName: string;
    course: string;
    batch: string;
  } | null>(null);

  const [sampleLeads, setSampleLeads] = useState<SampleLeadRow[]>(INITIAL_SAMPLE_LEADS);
  const [copiedWa, setCopiedWa] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = 'Live Interactive Demo — Website Enquiry Path Repair | AI Marketing Organization';
    const desc =
      'Interactive sample demo for training institutes: test a mobile-first course enquiry form, WhatsApp click-to-chat pre-fill preview, lead tracker, and before/after 390x844 breakdown.';
    let metaDesc = document.querySelector('meta[name="description"]');
    if (!metaDesc) {
      metaDesc = document.createElement('meta');
      metaDesc.setAttribute('name', 'description');
      document.head.appendChild(metaDesc);
    }
    metaDesc.setAttribute('content', desc);
    const canonicalUrl = `${window.location.origin}/demo`;
    let canonicalLink = document.querySelector('link[rel="canonical"]');
    if (!canonicalLink) {
      canonicalLink = document.createElement('link');
      canonicalLink.setAttribute('rel', 'canonical');
      document.head.appendChild(canonicalLink);
    }
    canonicalLink.setAttribute('href', canonicalUrl);
  }, []);

  const waMessage = `Hi, I am ${studentName.trim() || 'a prospective student'}. I want fee details and the next demo class schedule for ${selectedCourse} (${preferredBatch}).`;
  const waPreviewUrl = `https://wa.me/?text=${encodeURIComponent(waMessage)}`;

  const handleSampleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = studentName.trim() || 'Sample Student';
    const cleanPhone = studentPhone.replace(/\D/g, '');
    const masked =
      cleanPhone.length >= 4
        ? `+91 ${cleanPhone.slice(0, 2)}*** **${cleanPhone.slice(-3)}`
        : '+91 98*** **000';
    const sampleId = `SAMPLE-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    setSubmittedSample({
      sampleId,
      studentName: cleanName,
      course: selectedCourse,
      batch: preferredBatch
    });

    setSampleLeads(prev => [
      {
        id: sampleId,
        studentName: `${cleanName} (Sample)`,
        course: selectedCourse,
        phoneMasked: masked,
        stage: 'New',
        source: 'Sample Form'
      },
      ...prev
    ]);
  };

  const handleCycleStage = (id: string) => {
    setSampleLeads(prev =>
      prev.map(row => {
        if (row.id !== id) return row;
        const idx = STAGES.indexOf(row.stage);
        const nextStage = STAGES[(idx + 1) % STAGES.length];
        return { ...row, stage: nextStage };
      })
    );
  };

  const handleCopyWaText = async () => {
    try {
      await navigator.clipboard.writeText(waMessage);
      setCopiedWa(true);
      setTimeout(() => setCopiedWa(false), 1800);
    } catch {
      setCopiedWa(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      <nav className="border-b border-slate-800 bg-slate-950/95 sticky top-0 z-30 backdrop-blur" aria-label="Primary Navigation">
        <div className="max-w-5xl mx-auto px-4 py-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
          <a href="/" className="font-extrabold text-sm text-white whitespace-nowrap">
            AI Marketing Org
          </a>
          <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs font-semibold text-slate-400">
            <a href="/" className="hover:text-cyan-400 whitespace-nowrap">Home</a>
            <a href="/demo" className="text-cyan-400 whitespace-nowrap">Live Demo</a>
            <a href="/offer" className="hover:text-cyan-400 whitespace-nowrap">Founding Pilot</a>
            <a href="/contact" className="hover:text-cyan-400 whitespace-nowrap">Contact</a>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-4 py-8 space-y-8">
        <header className="space-y-3">
          <div className="inline-flex items-center gap-2 bg-cyan-500/10 text-cyan-300 border border-cyan-500/30 px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider">
            SAMPLE DEMO &bull; Browser-Only Walkthrough
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white tracking-tight">
            See What Your Repaired Enquiry Path Feels Like on Mobile
          </h1>
          <p className="text-sm sm:text-base text-slate-300 max-w-2xl">
            Test the exact layout components included in the <strong>Founding Pilot (₹1,999)</strong>: a mobile course enquiry form, a sample WhatsApp message preview, and a sample lead tracker. This page runs purely in your browser&apos;s React state — no real enquiry is sent and nothing is saved on a server.
          </p>
        </header>

        {/* 1 & 2: Sample Enquiry Form + Live WhatsApp Preview */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-white">1. Sample Course Enquiry Form</h2>
              <span className="text-[11px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2 py-0.5 rounded">
                SAMPLE DEMO
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Submits purely in your browser to demonstrate instant student confirmation and tracker capture.
            </p>
            <form onSubmit={handleSampleSubmit} className="space-y-3">
              <div>
                <label htmlFor="demo-course" className="block text-xs font-semibold text-slate-300 mb-1">
                  Course Track
                </label>
                <select
                  id="demo-course"
                  value={selectedCourse}
                  onChange={e => setSelectedCourse(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                >
                  <option value="Full-Stack Web Cohort">Full-Stack Web Cohort</option>
                  <option value="Data Analytics Bootcamp">Data Analytics Bootcamp</option>
                  <option value="UPSC / State PSC Foundation">UPSC / State PSC Foundation</option>
                  <option value="NEET / JEE Dropper Batch">NEET / JEE Dropper Batch</option>
                </select>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="demo-student" className="block text-xs font-semibold text-slate-300 mb-1">
                    Student Name *
                  </label>
                  <input
                    id="demo-student"
                    type="text"
                    required
                    value={studentName}
                    onChange={e => setStudentName(e.target.value)}
                    placeholder="e.g. Rohan Verma"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
                <div>
                  <label htmlFor="demo-phone" className="block text-xs font-semibold text-slate-300 mb-1">
                    Mobile Number *
                  </label>
                  <input
                    id="demo-phone"
                    type="tel"
                    required
                    value={studentPhone}
                    onChange={e => setStudentPhone(e.target.value)}
                    placeholder="9849000000"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="demo-batch" className="block text-xs font-semibold text-slate-300 mb-1">
                  Preferred Batch Timing
                </label>
                <select
                  id="demo-batch"
                  value={preferredBatch}
                  onChange={e => setPreferredBatch(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white"
                >
                  <option value="Morning Batch (8 AM)">Morning Batch (8 AM)</option>
                  <option value="Evening Batch (7 PM)">Evening Batch (7 PM)</option>
                  <option value="Weekend Fast-Track">Weekend Fast-Track</option>
                </select>
              </div>
              <button
                type="submit"
                className="w-full py-2.5 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm transition-colors"
              >
                Test Submit Sample Enquiry &rarr;
              </button>
            </form>

            {submittedSample && (
              <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-xs space-y-1">
                <div className="font-bold">
                  Sample Confirmation ({submittedSample.sampleId})
                </div>
                <div>
                  Logged <strong>{submittedSample.studentName}</strong> for{' '}
                  <strong>{submittedSample.course}</strong> ({submittedSample.batch}) into the sample tracker below.
                </div>
              </div>
            )}
          </section>

          <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-bold text-white">2. Sample WhatsApp Message Preview</h2>
              <span className="text-[11px] font-mono bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-2 py-0.5 rounded">
                SAMPLE PREVIEW
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Updates live in browser React state using generic <code>wa.me/?text=...</code> — not wired to a live institute number until configured during pilot handover.
            </p>
            <div className="bg-slate-950 border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="text-[11px] font-mono text-slate-400">Sample WhatsApp Message Preview (Local State)</div>
              <div className="bg-emerald-950/50 border border-emerald-500/30 rounded-lg p-3 text-sm text-emerald-100 leading-relaxed">
                {waMessage}
              </div>
              <div className="text-[11px] font-mono text-cyan-300 break-all bg-slate-900 p-2.5 rounded border border-slate-800">
                {waPreviewUrl}
              </div>
              <div className="flex flex-wrap gap-2.5">
                <a
                  href={waPreviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center justify-center px-4 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs"
                >
                  Sample WhatsApp Message Preview &rarr;
                </a>
                <button
                  type="button"
                  onClick={handleCopyWaText}
                  className="px-3.5 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-xs border border-slate-700"
                >
                  {copiedWa ? 'Copied Message' : 'Copy Pre-Filled Text'}
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* 3: Interactive Sample Lead Tracker */}
        <section className="bg-slate-900 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-white">3. Interactive Sample Lead Tracker</h2>
              <p className="text-xs text-slate-400">
                SAMPLE DATA ONLY — Click any stage pill to cycle{' '}
                <code>New &rarr; Contacted &rarr; Demo Scheduled &rarr; Enrolled</code>.
              </p>
            </div>
            <span className="text-[11px] font-mono bg-amber-500/15 text-amber-300 border border-amber-500/30 px-2.5 py-1 rounded">
              SAMPLE DATA
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs sm:text-sm">
              <thead>
                <tr className="border-b border-slate-800 text-slate-400">
                  <th className="py-2.5 pr-4 font-semibold">Student</th>
                  <th className="py-2.5 pr-4 font-semibold">Course</th>
                  <th className="py-2.5 pr-4 font-semibold">Source</th>
                  <th className="py-2.5 font-semibold">Stage (Click to Test)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80">
                {sampleLeads.map(row => (
                  <tr key={row.id}>
                    <td className="py-3 pr-4">
                      <div className="font-semibold text-white">{row.studentName}</div>
                      <div className="text-[11px] text-slate-400 font-mono">{row.phoneMasked}</div>
                    </td>
                    <td className="py-3 pr-4 text-slate-300">{row.course}</td>
                    <td className="py-3 pr-4 text-slate-400">{row.source}</td>
                    <td className="py-3">
                      <button
                        type="button"
                        onClick={() => handleCycleStage(row.id)}
                        className={`px-2.5 py-1 rounded-full text-xs font-bold border transition-colors ${
                          row.stage === 'Enrolled'
                            ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40'
                            : row.stage === 'Demo Scheduled'
                              ? 'bg-cyan-500/15 text-cyan-300 border-cyan-500/40'
                              : row.stage === 'Contacted'
                                ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                                : 'bg-slate-800 text-slate-200 border-slate-700'
                        }`}
                      >
                        {row.stage} &rarr;
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* 4: Visual Before / After Mobile Layout Breakdown */}
        <section className="space-y-4">
          <h2 className="text-lg font-bold text-white">4. Visual Before / After Mobile Breakdown (390&times;844)</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div className="bg-rose-950/20 border border-rose-500/30 rounded-2xl p-5 space-y-2.5">
              <div className="text-xs font-bold uppercase tracking-wider text-rose-300">Before Repair</div>
              <h3 className="text-base font-bold text-white">Leaked Enquiries &amp; Mobile Friction</h3>
              <ul className="text-xs sm:text-sm text-slate-300 space-y-1.5 list-disc pl-5">
                <li>Multi-row wrapping top bar pushes the enquiry button below the 844px fold.</li>
                <li>Horizontal table/banner overflow forces pinch-zooming on Android phones.</li>
                <li>Floating chat widgets cover footer links or hero CTA buttons.</li>
                <li>Plain phone numbers with no pre-filled WhatsApp course context.</li>
              </ul>
            </div>
            <div className="bg-emerald-950/20 border border-emerald-500/30 rounded-2xl p-5 space-y-2.5">
              <div className="text-xs font-bold uppercase tracking-wider text-emerald-300">After Repair</div>
              <h3 className="text-base font-bold text-white">Clean Above-the-Fold Admissions Path</h3>
              <ul className="text-xs sm:text-sm text-slate-300 space-y-1.5 list-disc pl-5">
                <li>Single-row mobile navigation keeps the primary headline and CTA visible immediately.</li>
                <li>Zero horizontal overflow at 390px width with tap-friendly inputs.</li>
                <li>Direct pre-filled WhatsApp link + instant structured lead tracker capture.</li>
                <li>Founding Pilot ₹1,999 (₹999 advance + ₹1,000 after live handover, 7-day bug-fix window).</li>
              </ul>
            </div>
          </div>
        </section>

        <section className="bg-slate-900 border border-cyan-500/40 rounded-2xl p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-bold text-white">Ready to Repair Your Institute&apos;s Enquiry Path?</h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-1">
              Founding Pilot ₹1,999 (₹999 advance + ₹1,000 after live handover, 7-day bug-fix window).
            </p>
          </div>
          <a
            href="/#pilot-enquiry"
            className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm whitespace-nowrap"
          >
            Request Founding Pilot &rarr;
          </a>
        </section>

        <footer className="text-center pt-6 border-t border-slate-800 text-xs text-slate-500 space-y-2">
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
      </main>
    </div>
  );
};
