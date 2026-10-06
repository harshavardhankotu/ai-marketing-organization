import React from 'react';
import { Shield, FileText, Info, Mail, Scale, ArrowLeft } from 'lucide-react';

interface PublicCompliancePageProps {
  path?: string;
  onNavigate?: (newPath: string) => void;
}

export const PublicCompliancePage: React.FC<PublicCompliancePageProps> = ({ path: initialPath, onNavigate }) => {
  const currentPath = initialPath || (typeof window !== 'undefined' ? window.location.pathname : '/privacy');

  const navigateTo = (newPath: string) => {
    if (onNavigate) {
      onNavigate(newPath);
    } else if (typeof window !== 'undefined') {
      window.history.pushState({}, '', newPath);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }
  };

  const renderContent = () => {
    if (currentPath === '/terms') {
      return (
        <article className="space-y-6 text-slate-300 text-sm leading-relaxed">
          <div className="flex items-center gap-3 text-cyan-400 font-semibold text-base mb-2">
            <Scale className="w-5 h-5 text-cyan-400" />
            <h2>Terms of Service &amp; Operating Agreement</h2>
          </div>
          <p>
            Welcome to the AI Marketing Organization Platform. By accessing, browsing, or utilizing this website, recommendation guides, or public service interfaces, you agree to be bound by these Terms of Service.
          </p>
          <section className="space-y-2">
            <h3 className="text-white font-medium text-base">1. Nature of Service &amp; Information Accuracy</h3>
            <p>
              Our guides, product comparisons, and informational articles are curated independently through data analysis and commercial market research. While we endeavor to ensure high accuracy, all product specifications, pricing, warranties, availability, and promotional terms are subject to change by respective manufacturers and merchants. Users are advised to verify critical purchase specifications directly on the provider&apos;s authoritative portal prior to completing any transaction.
            </p>
          </section>
          <section className="space-y-2">
            <h3 className="text-white font-medium text-base">2. Limitation of Liability</h3>
            <p>
              In no event shall the platform, its operators, or technical contributors be liable for any direct, indirect, incidental, or consequential damages resulting from transactions conducted with third-party providers linked through referral mechanisms.
            </p>
          </section>
          <section className="space-y-2">
            <h3 className="text-white font-medium text-base">3. Governing Law &amp; Jurisdiction</h3>
            <p>
              These terms are governed by and construed in accordance with the laws of India. Any disputes arising out of or related to the usage of this platform shall be subject to the exclusive jurisdiction of the competent courts in Hyderabad, Telangana, India.
            </p>
          </section>
        </article>
      );
    }

    if (currentPath === '/about') {
      return (
        <article className="space-y-6 text-slate-300 text-sm leading-relaxed">
          <div className="flex items-center gap-3 text-cyan-400 font-semibold text-base mb-2">
            <Info className="w-5 h-5 text-cyan-400" />
            <h2>About AI Marketing Organization</h2>
          </div>
          <p>
            AI Marketing Organization is an autonomous research, product evaluation, and inbound acquisition system engineered to connect consumers and small businesses with verified products, cloud software, and specialized local professional services.
          </p>
          <section className="space-y-2">
            <h3 className="text-white font-medium text-base">Our Principles</h3>
            <ul className="list-disc pl-5 space-y-1.5 text-slate-300">
              <li><strong>Zero Fabricated Reviews:</strong> We never generate, display, or quote artificial customer testimonials or unverified star ratings.</li>
              <li><strong>Evidence-Based Verification:</strong> All provider recommendations are matched to genuine demand signals and authorized fulfillment partners.</li>
              <li><strong>Privacy First:</strong> Visitor privacy is safeguarded in strict alignment with the Digital Personal Data Protection (DPDP) Act, 2023.</li>
            </ul>
          </section>
        </article>
      );
    }

    if (currentPath === '/contact') {
      return (
        <article className="space-y-6 text-slate-300 text-sm leading-relaxed">
          <div className="flex items-center gap-3 text-cyan-400 font-semibold text-base mb-2">
            <Mail className="w-5 h-5 text-cyan-400" />
            <h2>Contact &amp; Grievance Redressal</h2>
          </div>
          <p>
            For inquiries regarding our research guides, partnership authorizations, privacy requests, or statutory grievances, please reach out through our official communication channels:
          </p>
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-5 space-y-3">
            <div>
              <span className="text-xs uppercase tracking-wider text-slate-500 font-mono block">Data Fiduciary / Operator</span>
              <span className="text-white font-medium">AI Marketing Organization</span>
            </div>
            <div>
              <span className="text-xs uppercase tracking-wider text-slate-500 font-mono block">Official Contact Email</span>
              <a href="mailto:privacy@ai-marketing-organization.onrender.com" className="text-cyan-400 hover:underline">
                privacy@ai-marketing-organization.onrender.com
              </a>
            </div>
            <div>
              <span className="text-xs uppercase tracking-wider text-slate-500 font-mono block">Registered Operations Location</span>
              <span className="text-slate-300">Hyderabad, Telangana, India</span>
            </div>
            <div>
              <span className="text-xs uppercase tracking-wider text-slate-500 font-mono block">Statutory Grievance Redressal</span>
              <span className="text-slate-300">Under DPDP Act 2023 § 13, data principals may submit redressal requests regarding personal data directly via email with acknowledgment within 48 hours.</span>
            </div>
          </div>
        </article>
      );
    }

    if (currentPath === '/affiliate-disclosure') {
      return (
        <article className="space-y-6 text-slate-300 text-sm leading-relaxed">
          <div className="flex items-center gap-3 text-amber-400 font-semibold text-base mb-2">
            <FileText className="w-5 h-5 text-amber-400" />
            <h2>Affiliate &amp; Commercial Referral Disclosure</h2>
          </div>
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-200 font-medium">
            &quot;As an Amazon Associate I earn from qualifying purchases.&quot;
          </div>
          <section className="space-y-2">
            <h3 className="text-white font-medium text-base">Transparency Notice</h3>
            <p>
              The AI Marketing Organization website and associated recommendation guides contain affiliate and referral tracking links. When you click through one of these links and make a purchase or book an appointment on a partner website, our organization may receive a commission from the respective merchant or provider.
            </p>
            <p>
              <strong>Zero Extra Cost:</strong> This commission comes at absolutely no additional cost to you as a consumer. The price you pay on the merchant platform is identical whether you visit directly or via our tracked recommendation links.
            </p>
          </section>
          <section className="space-y-2">
            <h3 className="text-white font-medium text-base">Editorial &amp; Attribution Integrity</h3>
            <p>
              We maintain strict separation between editorial content quality and affiliate relationships. We do not accept payment to write positive reviews, nor do we fabricate star ratings, rankings, or testimonials. Referral links are strictly utilized to support continuous research, infrastructure upkeep, and autonomous market analysis.
            </p>
          </section>
        </article>
      );
    }

    // Default: /privacy
    return (
      <article className="space-y-6 text-slate-300 text-sm leading-relaxed">
        <div className="flex items-center gap-3 text-cyan-400 font-semibold text-base mb-2">
          <Shield className="w-5 h-5 text-cyan-400" />
          <h2>Privacy Policy &amp; Statutory DPDP Act Notice</h2>
        </div>
        <p>
          This Digital Privacy Policy governs personal data processing by <strong>AI Marketing Organization</strong> (&quot;Data Fiduciary&quot;) operating under the Digital Personal Data Protection (DPDP) Act, 2023 and the Information Technology Act, 2000 of India.
        </p>
        <section className="space-y-2">
          <h3 className="text-white font-medium text-base">1. Analytics &amp; Click Tracking Architecture</h3>
          <p>
            When you interact with our informational guides and click on outbound referral links (such as /r/* endpoints), our infrastructure logs technical attribution metadata to monitor campaign performance and prevent fraudulent robotic traffic.
          </p>
          <div className="bg-slate-900/80 border border-slate-800 rounded-xl p-4 text-xs font-mono space-y-2">
            <p className="text-cyan-300 font-semibold">Privacy Safeguards Applied:</p>
            <p>• <strong>Salted IP Hashing:</strong> We never retain your raw IP address in permanent records. IP addresses are combined with a server-side cryptographic secret salt and converted into irreversible SHA-256 hashes used solely for abuse prevention and rate-limiting.</p>
            <p>• <strong>Zero Cross-Site Profiling:</strong> We do not track your browsing activity across unrelated external websites.</p>
            <p>• <strong>Attribution Metadata:</strong> Parameters recorded include user-agent category, timestamp, referral source, and destination provider.</p>
          </div>
        </section>
        <section className="space-y-2">
          <h3 className="text-white font-medium text-base">2. Inbound Lead &amp; Booking Information</h3>
          <p>
            If you voluntarily submit your name, phone number, or inquiry details through an authorized local business booking funnel, this information is processed exclusively for the purpose of scheduling your appointment or responding to your service request. It is never sold to third-party data brokers or marketing list aggregators.
          </p>
        </section>
        <section className="space-y-2">
          <h3 className="text-white font-medium text-base">3. Rights of Data Principals under DPDP Act 2023</h3>
          <p>
            As a data principal, you maintain the statutory right to:
          </p>
          <ul className="list-disc pl-5 space-y-1 text-slate-300">
            <li>Request a summary of your personal data processed by us.</li>
            <li>Request correction or completion of inaccurate personal data.</li>
            <li>Request erasure of personal data no longer necessary for the specified purpose.</li>
            <li>Nominate another individual to exercise rights in the event of death or incapacity.</li>
            <li>Lodge a grievance with our Grievance Redressal Officer.</li>
          </ul>
        </section>
      </article>
    );
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-cyan-500 selection:text-white">
      {/* Header Bar */}
      <header className="border-b border-slate-800 bg-slate-900/60 backdrop-blur sticky top-0 z-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <a href="/" className="text-slate-400 hover:text-white flex items-center gap-1.5 text-xs font-medium transition-colors">
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </a>
            <div className="h-4 w-px bg-slate-800" />
            <h1 className="text-sm font-semibold text-white tracking-tight">Compliance &amp; Legal Center</h1>
          </div>
          <span className="text-[11px] font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-800/60 px-2 py-0.5 rounded-full">
            DPDP Act 2023 Compliant
          </span>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-8">
        {/* Navigation Tabs */}
        <nav className="flex flex-wrap gap-2 border-b border-slate-800 pb-4 mb-8">
          {[
            { label: 'Privacy Policy', path: '/privacy' },
            { label: 'Terms of Service', path: '/terms' },
            { label: 'Affiliate Disclosure', path: '/affiliate-disclosure' },
            { label: 'About Us', path: '/about' },
            { label: 'Contact & Grievance', path: '/contact' }
          ].map((tab) => {
            const isActive = currentPath === tab.path;
            return (
              <button
                key={tab.path}
                onClick={() => navigateTo(tab.path)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                  isActive
                    ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Legal Draft Advisory Notice */}
        <aside className="mb-8 p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs leading-relaxed">
          <div className="font-semibold text-amber-200 mb-1 flex items-center gap-2">
            <span>⚠️ Statutory Notice &amp; Legal Review Disclaimer</span>
          </div>
          <p>
            These statutory compliance materials represent working operational drafts engineered to satisfy Digital Personal Data Protection (DPDP) Act 2023, Information Technology Act 2000, and Amazon Associates Operating Agreement requirements. <strong>Notice: These documents require formal legal review and adaptation by qualified Indian legal counsel prior to formal corporate launch.</strong>
          </p>
        </aside>

        {/* Page Body */}
        {renderContent()}
      </main>

      {/* Universal Compliance Footer */}
      <footer className="border-t border-slate-800 bg-slate-900/40 mt-12 py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 text-center text-xs text-slate-500 space-y-4">
          <div className="flex flex-wrap justify-center gap-4 text-xs font-medium text-slate-400">
            <button onClick={() => navigateTo('/privacy')} className="hover:text-cyan-400">Privacy Policy</button>
            <span>•</span>
            <button onClick={() => navigateTo('/terms')} className="hover:text-cyan-400">Terms of Service</button>
            <span>•</span>
            <button onClick={() => navigateTo('/affiliate-disclosure')} className="hover:text-cyan-400">Affiliate Disclosure</button>
            <span>•</span>
            <button onClick={() => navigateTo('/about')} className="hover:text-cyan-400">About Us</button>
            <span>•</span>
            <button onClick={() => navigateTo('/contact')} className="hover:text-cyan-400">Contact &amp; Grievance</button>
          </div>
          <p>
            &copy; {new Date().getFullYear()} AI Marketing Organization. All rights reserved. Registered in India under DPDP Act 2023.
          </p>
        </div>
      </footer>
    </div>
  );
};
