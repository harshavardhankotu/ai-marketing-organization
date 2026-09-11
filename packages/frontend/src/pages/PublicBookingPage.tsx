import React, { useState } from 'react';
import { 
  Sparkles, 
  MapPin, 
  ShieldCheck, 
  Clock, 
  Phone, 
  CheckCircle2, 
  IndianRupee, 
  Calendar,
  ChevronRight,
  Award,
  AlertCircle
} from 'lucide-react';

export const PublicBookingPage: React.FC<{ onBackToAdmin?: () => void }> = ({ onBackToAdmin }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [location, setLocation] = useState('Gachibowli');
  const [treatment, setTreatment] = useState('Invisible Clear Aligners');
  const [date, setDate] = useState('2026-09-15');
  const [notes, setNotes] = useState('');
  
  const [submitting, setSubmitting] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setErrorMsg('');

    try {
      const res = await fetch('/api/v1/public/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessId: 'biz_smilekraft_hyd',
          organizationId: 'org_smilekraft_01',
          customerName: name,
          customerPhone: phone,
          customerEmail: email || undefined,
          channel: 'WHATSAPP',
          campaignId: 'camp_seed_aligners_01',
          source: 'meta_ads_gachibowli_campaign',
          serviceOfInterest: treatment,
          notes: `Preferred Location: ${location}, Date: ${date}. ${notes}`
        })
      });

      const json = await res.json();
      if (!res.ok || !json.success) {
        throw new Error(json.error || 'Failed to submit consultation request');
      }

      setConfirmedBooking(json.data);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* Top Banner with MCI compliance notice */}
      <div className="bg-gradient-to-r from-cyan-900/60 to-blue-900/60 border-b border-cyan-800/40 px-4 py-2 text-xs text-center text-cyan-200">
        <span className="font-semibold">SmileKraft Dental Clinic</span> • Certified Specialists in Banjara Hills & Gachibowli • MCI & NMC Ethically Compliant
        {onBackToAdmin && (
          <button 
            onClick={onBackToAdmin} 
            className="ml-4 underline text-cyan-300 hover:text-white font-medium"
          >
            ← Return to Marketing Management Console
          </button>
        )}
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Clinic Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            Hyderabad Premier Pain-Free Smile Transformation
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            SmileKraft Dental Clinic
          </h1>
          <p className="text-sm text-slate-400 max-w-xl mx-auto">
            Led by <strong>Dr. Aravind Reddy (MDS Orthodontics, 15+ Yrs Exp)</strong>. Digital 3D smile planning, German titanium implants, and invisible aligners.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-slate-300 pt-2">
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-cyan-400" />
              Banjara Hills (Rd #12) & Gachibowli (Financial District)
            </span>
            <span className="flex items-center gap-1">
              <Award className="w-3.5 h-3.5 text-amber-400" />
              US-FDA Approved Materials
            </span>
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              100% Pain-Free Laser Tech
            </span>
          </div>
        </div>

        {/* Highlight Treatment Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-5 rounded-2xl bg-slate-900/80 border border-cyan-500/30 shadow-lg shadow-cyan-500/5 relative overflow-hidden">
            <div className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Most Popular</div>
            <div className="text-lg font-bold text-white mt-1">Invisible Clear Aligners</div>
            <div className="text-xs text-slate-400 mt-1">Custom 3D-molded teeth straightening. Removable, discreet, comfortable.</div>
            <div className="mt-4 flex items-baseline gap-1 font-mono">
              <span className="text-2xl font-black text-cyan-300">₹45,000</span>
              <span className="text-xs text-slate-400">or ₹2,999/mo 0% EMI</span>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-md">
            <div className="text-xs font-bold text-teal-400 uppercase tracking-wider">Restorative</div>
            <div className="text-lg font-bold text-white mt-1">Titanium Dental Implants</div>
            <div className="text-xs text-slate-400 mt-1">German bio-compatible implants with lifetime warranty and immediate crown.</div>
            <div className="mt-4 flex items-baseline gap-1 font-mono">
              <span className="text-2xl font-black text-white">₹28,000</span>
              <span className="text-xs text-slate-400">per tooth</span>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/80 border border-slate-800 shadow-md">
            <div className="text-xs font-bold text-amber-400 uppercase tracking-wider">Cosmetic</div>
            <div className="text-lg font-bold text-white mt-1">Laser Teeth Whitening</div>
            <div className="text-xs text-slate-400 mt-1">1-hour clinic session. Up to 8 shades brighter for weddings and celebrations.</div>
            <div className="mt-4 flex items-baseline gap-1 font-mono">
              <span className="text-2xl font-black text-white">₹7,500</span>
              <span className="text-xs text-slate-400">complete session</span>
            </div>
          </div>
        </div>

        {/* Booking Form or Success Card */}
        <div className="p-6 sm:p-8 rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl">
          {confirmedBooking ? (
            <div className="text-center py-6 space-y-4">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-bold text-white">
                Consultation Request Confirmed!
              </h2>
              <p className="text-sm text-slate-300 max-w-md mx-auto">
                Thank you, <strong>{name}</strong>. Your consultation has been registered with SmileKraft Dental.
              </p>
              
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-left max-w-md mx-auto space-y-2 font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-400">Patient Identifier:</span>
                  <span className="text-cyan-400">{confirmedBooking.visitorId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Journey Status:</span>
                  <span className="text-emerald-400 font-semibold">{confirmedBooking.stage} (REAL)</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Clinic Center:</span>
                  <span className="text-white">{location} Hyderabad</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Treatment:</span>
                  <span className="text-white">{treatment}</span>
                </div>
              </div>

              <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
                <a
                  href={`https://wa.me/919876543210?text=Hello%20Dr%20Aravind,%20I%20registered%20my%20consultation%20for%20${encodeURIComponent(treatment)}%20at%20${location}%20branch.`}
                  target="_blank"
                  rel="noreferrer"
                  className="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20"
                >
                  <Phone className="w-4 h-4" />
                  Chat with Clinic on WhatsApp
                </a>
                <button
                  onClick={() => {
                    setConfirmedBooking(null);
                    setName('');
                    setPhone('');
                  }}
                  className="w-full sm:w-auto px-6 py-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs"
                >
                  Book Another Consultation
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-cyan-400" />
                  Book Doctor Consultation & 3D Scan
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Fill out your details below to schedule your personalized smile assessment in Hyderabad.
                </p>
              </div>

              {errorMsg && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {errorMsg}
                </div>
              )}

              <form onSubmit={handleBookingSubmit} className="space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Full Name *
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Sravan Kumar"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      WhatsApp Mobile Number *
                    </label>
                    <input
                      type="tel"
                      required
                      placeholder="+91-9876543210"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Email Address (Optional)
                    </label>
                    <input
                      type="email"
                      placeholder="name@company.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                    />
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Preferred Clinic Center *
                    </label>
                    <select
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="Gachibowli">Gachibowli (Financial District)</option>
                      <option value="Banjara Hills">Banjara Hills (Road #12)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Treatment Needed *
                    </label>
                    <select
                      value={treatment}
                      onChange={(e) => setTreatment(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white focus:outline-none focus:border-cyan-500"
                    >
                      <option value="Invisible Clear Aligners">Invisible Clear Aligners (₹45,000)</option>
                      <option value="Titanium Dental Implants">Titanium Dental Implants (₹28,000)</option>
                      <option value="Laser Teeth Whitening">Laser Teeth Whitening (₹7,500)</option>
                      <option value="General Consultation">General Dental Checkup</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Additional Notes or Symptoms (Optional)
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Describe any tooth discomfort or smile goals..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={submitting}
                    className="w-full py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-sm tracking-wide shadow-xl shadow-cyan-500/20 transition-all flex items-center justify-center gap-2"
                  >
                    {submitting ? 'Registering Consultation...' : 'Confirm Doctor Consultation'}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>

        {/* MCI & Regulatory Compliance Footer */}
        <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/60 text-[11px] text-slate-500 space-y-1.5 leading-relaxed">
          <div className="font-semibold text-slate-400 uppercase tracking-wider">
            Statutory Medical Notice & Disclosure
          </div>
          <div>
            1. All orthodontic and implant procedures are performed exclusively by registered dental practitioners licensed by the Telangana State Dental Council and Dental Council of India (DCI).
          </div>
          <div>
            2. Medical Council of India (MCI) & NMC Ethics: This page is designed for patient education and appointment scheduling. Treatment suitability and exact cost estimates depend upon clinical oral examination and 3D radiographic scans.
          </div>
          <div>
            3. Patient Privacy: Contact information is strictly protected under the Information Technology Act 2000 and used solely for direct clinic consultation coordination.
          </div>
        </div>
      </div>
    </div>
  );
};
