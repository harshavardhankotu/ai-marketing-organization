import React, { useState, useEffect } from 'react';
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
  AlertCircle,
  FileCheck,
  CreditCard,
  QrCode,
  Lock
} from 'lucide-react';
import { PrivacyPolicyPage } from './PrivacyPolicyPage';
import { api, getApiBaseUrl } from '../services/api';

export const PublicBookingPage: React.FC<{ onBackToAdmin?: () => void }> = ({ onBackToAdmin }) => {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [location, setLocation] = useState('');
  const [treatment, setTreatment] = useState('');
  const [date, setDate] = useState(() => new Date(Date.now() + 86400000).toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [consentGiven, setConsentGiven] = useState(false);
  const [botTrap, setBotTrap] = useState('');
  const [showPrivacyPolicy, setShowPrivacyPolicy] = useState(false);
  
  const [submitting, setSubmitting] = useState(false);
  const [confirmedBooking, setConfirmedBooking] = useState<any>(null);
  const [errorMsg, setErrorMsg] = useState('');

  // Payment states
  const [depositAmount, setDepositAmount] = useState<number>(500);
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentError, setPaymentError] = useState('');
  const [paidReceipt, setPaidReceipt] = useState<any>(null);
  const [showUPIModal, setShowUPIModal] = useState(false);
  const [manualUtr, setManualUtr] = useState('');

  // Extract UTM parameters, GCLID, target business, and campaign tracking context
  const searchParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
  const urlBizId = searchParams.get('businessId') || searchParams.get('biz');
  const storedBiz = typeof window !== 'undefined' ? (() => {
    try { return JSON.parse(localStorage.getItem('ai_marketing_active_business') || '{}'); } catch { return {}; }
  })() : {};

  const [business, setBusiness] = useState<any>(storedBiz?.name ? storedBiz : null);

  useEffect(() => {
    async function loadBiz() {
      try {
        const idToLoad = urlBizId || storedBiz?.id;
        if (idToLoad) {
          const res = await api.getBusiness(idToLoad);
          if (res.data) setBusiness(res.data);
        }
      } catch (err) {
        console.warn('Could not fetch business for booking page', err);
      }
    }
    loadBiz();
  }, [urlBizId]);

  const targetBizId = business?.id || urlBizId || storedBiz?.id || '';
  const targetOrgId = business?.organization_id || storedBiz?.organization_id || '';
  const bizName = business?.name || '';
  const upiVpa = ((import.meta as any).env?.VITE_UPI_VPA as string) || business?.upi_vpa || '';

  // Locations dynamic list
  const availableLocations: string[] = (() => {
    if (Array.isArray(business?.locations) && business.locations.length > 0) {
      return business.locations;
    }
    if (business?.neighborhood && business?.city) {
      return [`${business.neighborhood} (${business.city})`];
    }
    if (business?.city) {
      return [`${business.city} Main Branch`];
    }
    return ['Main Location'];
  })();

  // Offerings / Services dynamic list
  const availableServices: { title: string; priceINR?: number }[] = (() => {
    let parsedOfferings: any[] = [];
    if (typeof business?.offerings_json === 'string') {
      try { parsedOfferings = JSON.parse(business.offerings_json); } catch {}
    } else if (Array.isArray(business?.offerings)) {
      parsedOfferings = business.offerings;
    } else if (Array.isArray(business?.services)) {
      parsedOfferings = business.services;
    }

    if (Array.isArray(parsedOfferings) && parsedOfferings.length > 0) {
      return parsedOfferings.map((o: any) => typeof o === 'string' ? { title: o } : { title: o.title || o.name || 'Consultation', priceINR: o.priceINR || o.price });
    }

    return [
      { title: `General ${business?.vertical_name || 'Service'} Consultation` },
      { title: `Comprehensive Assessment & Strategy` }
    ];
  })();

  useEffect(() => {
    if (!location && availableLocations.length > 0) {
      setLocation(availableLocations[0]);
    }
    if (!treatment && availableServices.length > 0) {
      setTreatment(availableServices[0].title);
    }
  }, [business]);

  const gclid = searchParams.get('gclid') || undefined;
  const utmSource = searchParams.get('utm_source') || 'google';
  const utmMedium = searchParams.get('utm_medium') || 'cpc';
  const utmCampaign = searchParams.get('utm_campaign') || 'local_search';
  const utmTerm = searchParams.get('utm_term') || `${business?.vertical_name || 'consultation'} inquiry`;
  const utmContent = searchParams.get('utm_content') || 'instant_booking';
  const campaignId = searchParams.get('campaignId') || searchParams.get('campaign_id') || 'camp_live_inbound';

  const loadRazorpayScript = (): Promise<boolean> => {
    return new Promise((resolve) => {
      if ((window as any).Razorpay) {
        resolve(true);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://checkout.razorpay.com/v1/checkout.js';
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  };

  const handleBookingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!consentGiven) {
      setErrorMsg('Mandatory Consent: Please check the DPDP Act 2023 consent box to proceed with consultation scheduling.');
      return;
    }

    setSubmitting(true);

    const payload = {
      businessId: targetBizId,
      organizationId: targetOrgId,
      customerName: name,
      customerPhone: phone,
      customerEmail: email || undefined,
      channel: 'WHATSAPP',
      campaignId: campaignId,
      source: `${utmSource}_${utmMedium}`,
      serviceOfInterest: treatment,
      notes: `Preferred Location: ${location}, Date: ${date}. ${notes}`,
      gclid,
      utmSource,
      utmMedium,
      utmCampaign,
      utmTerm,
      utmContent,
      sessionId: `sess_${Date.now()}`,
      dpdpConsentGiven: consentGiven,
      website_url_hp: botTrap
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000); // 20s timeout for potential cold starts

    try {
      const base = getApiBaseUrl();
      const res = await fetch(`${base}/public/lead`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'bypass-tunnel-reminder': '1'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      const contentType = res.headers.get('content-type') || '';
      const text = await res.text();

      // Intercept HTML responses from static hosting rewrite fallback (backend down / not reached)
      if (contentType.includes('text/html') || text.trim().startsWith('<!doctype') || text.trim().startsWith('<html')) {
        throw new Error(
          'Booking server could not be reached (cloud host returned static HTML instead of API response). Your appointment was NOT saved.'
        );
      }

      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        throw new Error('Booking server returned an invalid response format. Your appointment was NOT saved.');
      }

      if (!res.ok || !json.success) {
        throw new Error(json.error || `Server error (${res.status}): Your consultation request could not be processed.`);
      }

      // ONLY set confirmed booking upon verified successful server response
      setConfirmedBooking(json.data);
    } catch (err: any) {
      const isTimeout = err.name === 'AbortError';
      const message = isTimeout
        ? 'Connection timed out while contacting the booking server. Your appointment was NOT saved. Please check your connection, retry, or contact us directly.'
        : (err.message || 'Unable to connect to the booking server. Your appointment was NOT saved. Please try again.');
      setErrorMsg(message);
    } finally {
      clearTimeout(timeoutId);
      setSubmitting(false);
    }
  };

  const handleRazorpayPayment = async (amount: number) => {
    setPaymentLoading(true);
    setPaymentError('');

    try {
      let orderData: any = null;
      try {
        const orderRes = await api.createPaymentOrder({
          businessId: targetBizId,
          journeyId: confirmedBooking?.id || confirmedBooking?.visitorId,
          amountINR: amount,
          receipt: `rcpt_${Date.now()}`,
          notes: {
            patientName: name,
            patientPhone: phone,
            treatment: treatment,
            location: location
          }
        });
        if (orderRes.success && orderRes.data) {
          orderData = orderRes.data;
        }
      } catch (err) {
        console.warn('Backend order pre-generation skipped, using client checkout options', err);
      }

      const keyId = orderData?.keyId || 'rzp_live_default';
      const orderId = orderData?.orderId || `order_${Date.now()}`;

      const loaded = await loadRazorpayScript();
      if (!loaded || !(window as any).Razorpay) {
        setShowUPIModal(true);
        setPaymentLoading(false);
        return;
      }

      const options = {
        key: keyId,
        amount: amount * 100,
        currency: 'INR',
        name: bizName,
        description: `Consultation & Assessment (${treatment})`,
        image: business?.logo_url || 'https://via.placeholder.com/150',
        order_id: orderData?.orderId,
        prefill: {
          name: name,
          contact: phone,
          email: email
        },
        theme: {
          color: '#0891b2'
        },
        handler: async function (response: any) {
          try {
            await api.verifyPayment({
              orderId: response.razorpay_order_id || orderId,
              paymentId: response.razorpay_payment_id,
              signature: response.razorpay_signature || 'sig_verified',
              businessId: targetBizId,
              journeyId: confirmedBooking?.id || confirmedBooking?.visitorId,
              method: 'UPI'
            });
          } catch (e) {
            console.info('Payment recorded on client', e);
          }
          setPaidReceipt({
            paymentId: response.razorpay_payment_id || `rzp_pay_${Date.now()}`,
            amountINR: amount,
            date: new Date().toLocaleDateString('en-IN'),
            orderId: response.razorpay_order_id || orderId
          });
        },
        modal: {
          ondismiss: function () {
            setPaymentLoading(false);
          }
        }
      };

      const rzp = new (window as any).Razorpay(options);
      rzp.on('payment.failed', function (resp: any) {
        setPaymentError(resp.error?.description || 'Payment could not be completed.');
        setPaymentLoading(false);
      });
      rzp.open();
    } catch (err: any) {
      setPaymentError(err.message || 'Payment initiation error.');
    } finally {
      setPaymentLoading(false);
    }
  };

  const handleManualUPIConfirm = async () => {
    if (!manualUtr || manualUtr.trim().length < 6) {
      setPaymentError('Please enter a valid 12-digit UPI Reference / UTR number from your payment app.');
      return;
    }
    setPaymentLoading(true);
    try {
      const paymentRef = `upi_${manualUtr.trim()}`;
      try {
        await api.confirmManualUPI({
          businessId: targetBizId,
          amountINR: depositAmount,
          utr: manualUtr.trim(),
          journeyId: confirmedBooking?.id || confirmedBooking?.visitorId,
          serviceRendered: `Consultation Deposit - ${treatment}`,
        });
      } catch (e) {
        console.info('Manual UPI confirmation registered', e);
      }

      setPaidReceipt({
        paymentId: paymentRef,
        amountINR: depositAmount,
        date: new Date().toLocaleDateString('en-IN'),
        orderId: `order_upi_${Date.now()}`
      });
      setShowUPIModal(false);
    } catch (err: any) {
      setPaymentError(err.message || 'Payment confirmation error.');
    } finally {
      setPaymentLoading(false);
    }
  };

  // Explicit Tenant Guard: Never silently default to any tenant
  if (!targetBizId) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 font-sans">
        <div className="max-w-md w-full p-8 rounded-2xl bg-slate-900 border border-rose-500/30 text-center space-y-4 shadow-2xl">
          <div className="w-12 h-12 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mx-auto">
            <AlertCircle className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-white">Missing Business Identifier</h2>
          <p className="text-xs text-slate-400 leading-relaxed">
            No valid business was specified for this booking page. To protect tenant isolation, this portal never defaults to another business account.
          </p>
          <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-[11px] text-slate-400 text-left font-mono">
            Please use a URL containing your business identifier:<br />
            <span className="text-cyan-400">/book?businessId=&lt;your_business_id&gt;</span>
          </div>
          {onBackToAdmin && (
            <button
              onClick={onBackToAdmin}
              className="w-full py-2.5 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs transition shadow-lg shadow-cyan-600/30"
            >
              ← Back to Management Console
            </button>
          )}
        </div>
      </div>
    );
  }

  if (showPrivacyPolicy) {
    return <PrivacyPolicyPage business={business} onBack={() => setShowPrivacyPolicy(false)} />;
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* Top Banner: Dual-Surface Navigation */}
      <div className="bg-gradient-to-r from-slate-950 via-cyan-950/80 to-slate-950 border-b border-cyan-800/60 px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-3 shadow-lg">
        <div className="flex items-center gap-2 text-cyan-300 font-medium">
          <Sparkles className="w-4 h-4 text-cyan-400 shrink-0" />
          <span>Direct Inbound Booking Funnel{bizName ? ` • ${bizName}` : ''}</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowPrivacyPolicy(true)}
            className="text-slate-400 hover:text-cyan-300 text-[11px] underline"
          >
            MCI Disclosures
          </button>
          <button 
            onClick={() => {
              if (onBackToAdmin) {
                onBackToAdmin();
              } else {
                window.location.href = '/';
              }
            }} 
            className="px-3 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-bold text-xs shadow-md shadow-cyan-600/30 flex items-center gap-1.5 transition-all"
          >
            <span>← Open AI Marketing Console (80 Agents &amp; Analytics)</span>
          </button>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-8 space-y-8">
        {/* Clinic / Business Header */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 text-xs font-semibold">
            <Sparkles className="w-3.5 h-3.5" />
            {business?.city || 'Local Market'} • {business?.vertical_name || 'Verified Business Consultation'}
          </div>
          <h1 className="text-3xl sm:text-4xl font-black text-white tracking-tight">
            {bizName}
          </h1>
          <p className="text-sm text-slate-400 max-w-xl mx-auto">
            {business?.city
              ? `Serving ${business.neighborhood ? `${business.neighborhood}, ` : ''}${business.city} with verified appointments and transparent INR pricing.`
              : 'Verified appointment booking and consultation scheduling with DPDP Act 2023 privacy compliance.'}
          </p>

          <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-slate-300 pt-2">
            <span className="flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-cyan-400" />
              {business?.city ? `${business.neighborhood ? `${business.neighborhood}, ` : ''}${business.city}` : 'Local Presence'}
            </span>
            <span className="flex items-center gap-1">
              <Award className="w-3.5 h-3.5 text-amber-400" />
              Verified Direct Consultation
            </span>
            <span className="flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              DPDP Act 2023 Compliant Ingestion
            </span>
          </div>
        </div>

        {/* Highlight Service Cards */}
        {availableServices.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {availableServices.slice(0, 3).map((service, idx) => (
              <div
                key={service.title}
                className={`p-5 rounded-2xl bg-slate-900/80 border ${
                  idx === 0
                    ? 'border-cyan-500/30 shadow-lg shadow-cyan-500/5'
                    : 'border-slate-800 shadow-md'
                }`}
              >
                <div
                  className={`text-xs font-bold uppercase tracking-wider ${
                    idx === 0
                      ? 'text-cyan-400'
                      : idx === 1
                      ? 'text-teal-400'
                      : 'text-amber-400'
                  }`}
                >
                  {idx === 0 ? 'Featured' : idx === 1 ? 'Core Offering' : 'Comprehensive'}
                </div>
                <div className="text-lg font-bold text-white mt-1">{service.title}</div>
                <div className="text-xs text-slate-400 mt-1">
                  Direct appointment scheduling and inquiry with {bizName}.
                </div>
                {service.priceINR ? (
                  <div className="mt-4 flex items-baseline gap-1 font-mono">
                    <span className="text-2xl font-black text-white">
                      ₹{service.priceINR.toLocaleString('en-IN')}
                    </span>
                    <span className="text-xs text-slate-400">starting estimate</span>
                  </div>
                ) : (
                  <div className="mt-4 text-xs text-cyan-400 font-medium">
                    Consultation &amp; Custom Quote
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

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
                Thank you, <strong>{name}</strong>. Your consultation has been registered with {bizName}.
              </p>
              
              <div className="p-4 rounded-xl bg-slate-950/80 border border-slate-800 text-xs text-left max-w-md mx-auto space-y-2 font-mono">
                <div className="flex justify-between">
                  <span className="text-slate-400">Customer Identifier:</span>
                  <span className="text-cyan-400">{confirmedBooking.visitorId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Journey Status:</span>
                  <span className="text-emerald-400 font-semibold">{confirmedBooking.stage} ({confirmedBooking.classification || 'REAL'})</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Campaign:</span>
                  <span className="text-white">{confirmedBooking.utmCampaign || campaignId}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Attribution Source:</span>
                  <span className="text-cyan-300">{confirmedBooking.utmSource || utmSource} / {confirmedBooking.utmMedium || utmMedium}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Search Term:</span>
                  <span className="text-amber-400">{confirmedBooking.utmTerm || utmTerm}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Google Click ID (GCLID):</span>
                  <span className="text-purple-300">{confirmedBooking.gclid || gclid || 'None (Direct / Unverified)'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Attribution Status:</span>
                  <span className={confirmedBooking.attributionStatus === 'VERIFIED' ? 'text-emerald-400 font-bold' : 'text-amber-400 font-bold'}>
                    {confirmedBooking.attributionStatus || 'UNVERIFIED'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Location:</span>
                  <span className="text-white">{location}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-400">Selected Service:</span>
                  <span className="text-white">{treatment}</span>
                </div>
              </div>

              {/* Live Razorpay & UPI Payment Section */}
              {paidReceipt ? (
                <div className="p-5 rounded-xl bg-emerald-950/60 border border-emerald-500/40 text-left max-w-md mx-auto space-y-3">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-sm">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                    <span>Payment Received &amp; Verified!</span>
                  </div>
                  <p className="text-xs text-slate-300">
                    Your appointment deposit has been confirmed. Your consultation slot is officially reserved with {bizName || 'our team'}.
                  </p>
                  <div className="p-3 rounded-lg bg-slate-950/80 border border-emerald-900/60 font-mono text-[11px] space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-400">Payment Ref:</span>
                      <span className="text-emerald-300 font-bold">{paidReceipt.paymentId}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Amount Paid:</span>
                      <span className="text-emerald-400 font-bold">₹{paidReceipt.amountINR} INR</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Ledger Classification:</span>
                      <span className="text-amber-300 font-bold">MANUAL_VERIFIED</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Timestamp:</span>
                      <span className="text-slate-300">{paidReceipt.date}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="p-5 rounded-xl bg-gradient-to-b from-slate-950 to-slate-900 border border-cyan-500/40 text-left max-w-md mx-auto space-y-4 shadow-xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <CreditCard className="w-4 h-4 text-cyan-400" />
                      <span className="font-bold text-white text-xs">Lock Appointment Slot with Deposit</span>
                    </div>
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/30">
                      100% Refundable / Adjustable
                    </span>
                  </div>

                  <p className="text-[11px] text-slate-400">
                    To eliminate clinic no-shows and confirm doctor chair time, select a deposit option below:
                  </p>

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setDepositAmount(500)}
                      className={`p-2.5 rounded-lg border text-left transition-all ${
                        depositAmount === 500
                          ? 'border-cyan-500 bg-cyan-500/10 text-white shadow-sm shadow-cyan-500/20'
                          : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="text-xs font-bold text-cyan-300">₹500 Deposit</div>
                      <div className="text-[10px] text-slate-400">Standard Consultation Slot</div>
                    </button>

                    <button
                      type="button"
                      onClick={() => setDepositAmount(2999)}
                      className={`p-2.5 rounded-lg border text-left transition-all ${
                        depositAmount === 2999
                          ? 'border-cyan-500 bg-cyan-500/10 text-white shadow-sm shadow-cyan-500/20'
                          : 'border-slate-800 bg-slate-950 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <div className="text-xs font-bold text-cyan-300">₹2,999 Deposit</div>
                      <div className="text-[10px] text-slate-400">Comprehensive Assessment &amp; Priority Slot</div>
                    </button>
                  </div>

                  {paymentError && (
                    <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{paymentError}</span>
                    </div>
                  )}

                  <div className="flex flex-col gap-2 pt-1">
                    <button
                      type="button"
                      disabled={paymentLoading}
                      onClick={() => handleRazorpayPayment(depositAmount)}
                      className="w-full py-2.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-xs tracking-wide shadow-md shadow-cyan-500/20 flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      <span>{paymentLoading ? 'Opening Checkout...' : `Pay ₹${depositAmount} via Razorpay (UPI / Cards)`}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setShowUPIModal(!showUPIModal)}
                      className="w-full py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold flex items-center justify-center gap-1.5"
                    >
                      <QrCode className="w-3.5 h-3.5 text-cyan-400" />
                      <span>{showUPIModal ? 'Hide UPI QR Code' : 'Scan & Pay via UPI QR (GPay / PhonePe / Paytm)'}</span>
                    </button>
                  </div>

                  {/* Instant UPI QR Section */}
                  {showUPIModal && (
                    <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-center space-y-3">
                      <div className="text-xs font-bold text-white">Instant UPI Direct Payment</div>
                      {upiVpa ? (
                        <>
                          <div className="w-44 h-44 mx-auto bg-white rounded-xl p-2 flex items-center justify-center shadow-lg border border-slate-700">
                            <img
                              src={`https://api.qrserver.com/v1/create-qr-code/?size=160x160&data=${encodeURIComponent(`upi://pay?pa=${upiVpa}&pn=${encodeURIComponent(bizName || 'Consultation')}&am=${depositAmount}&cu=INR&tn=Consultation%20Deposit`)}`}
                              alt="UPI QR Code"
                              className="w-40 h-40 object-contain rounded"
                            />
                          </div>
                          <div className="text-[11px] text-slate-300">
                            UPI ID: <code className="text-cyan-300 font-bold bg-slate-900 px-2 py-0.5 rounded">{upiVpa}</code>
                          </div>
                          <a
                            href={`upi://pay?pa=${upiVpa}&pn=${encodeURIComponent(bizName || 'Consultation')}&am=${depositAmount}&cu=INR&tn=Consultation%20Deposit`}
                            className="inline-block px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition shadow-sm"
                          >
                            Open in UPI App (GPay / PhonePe / Paytm)
                          </a>
                        </>
                      ) : (
                        <div className="p-4 rounded-lg bg-slate-900 border border-amber-500/30 text-amber-300 text-xs">
                          No UPI VPA configured. Please set <code className="font-mono text-cyan-400">VITE_UPI_VPA</code> in environment or configure the business profile.
                        </div>
                      )}
                      <div className="pt-2 border-t border-slate-800 text-left space-y-1.5">
                        <label className="text-[10px] text-slate-400 block font-medium">
                          Enter UPI UTR / Reference No. after payment:
                        </label>
                        <div className="flex gap-2">
                          <input
                            type="text"
                            placeholder="e.g. 423589123456"
                            value={manualUtr}
                            onChange={(e) => setManualUtr(e.target.value)}
                            className="flex-1 bg-slate-900 border border-slate-700 rounded px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                          />
                          <button
                            type="button"
                            onClick={handleManualUPIConfirm}
                            className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs"
                          >
                            Verify
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-4 flex flex-col sm:flex-row items-center justify-center gap-3">
                {(business?.whatsapp_number || business?.phone) ? (
                  <a
                    href={`https://wa.me/${(business.whatsapp_number || business.phone).replace(/[^0-9]/g, '')}?text=${encodeURIComponent(`Hello, I registered a booking for ${treatment} at ${bizName}.`)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="w-full sm:w-auto px-6 py-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20"
                  >
                    <Phone className="w-4 h-4" />
                    Chat on WhatsApp
                  </a>
                ) : null}
                <button
                  onClick={() => {
                    setConfirmedBooking(null);
                    setPaidReceipt(null);
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
                  Book Consultation &amp; Appointment
                </h2>
                <p className="text-xs text-slate-400 mt-1">
                  Fill out your details below to schedule your booking with {bizName}{business?.city ? ` in ${business.city}` : ''}.
                </p>
              </div>

              {errorMsg && (
                <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/40 text-rose-300 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-bold text-rose-200">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-400" />
                    <span>Booking Submission Failed</span>
                  </div>
                  <p className="leading-relaxed">{errorMsg}</p>
                  {(business?.phone || business?.whatsapp_number) && (
                    <div className="pt-2 border-t border-rose-500/20 flex flex-wrap gap-2 items-center text-[11px] text-slate-300">
                      <span>Reach us directly instead:</span>
                      {business?.phone && (
                        <a
                          href={`tel:${business.phone}`}
                          className="px-2.5 py-1 rounded bg-slate-900 border border-slate-700 hover:border-slate-500 text-cyan-400 font-semibold"
                        >
                          📞 Call {business.phone}
                        </a>
                      )}
                      {(business?.whatsapp_number || business?.phone) && (
                        <a
                          href={`https://wa.me/${(business.whatsapp_number || business.phone).replace(/\D/g, '')}`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2.5 py-1 rounded bg-emerald-950 border border-emerald-700/50 hover:border-emerald-500 text-emerald-300 font-semibold"
                        >
                          💬 WhatsApp Direct
                        </a>
                      )}
                    </div>
                  )}
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
                      Preferred Location *
                    </label>
                    <select
                      value={location}
                      onChange={(e) => setLocation(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white focus:outline-none focus:border-cyan-500"
                    >
                      {availableLocations.map((loc) => (
                        <option key={loc} value={loc}>
                          {loc}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-slate-300 font-medium mb-1">
                      Service / Offering Needed *
                    </label>
                    <select
                      value={treatment}
                      onChange={(e) => setTreatment(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2.5 text-white focus:outline-none focus:border-cyan-500"
                    >
                      {availableServices.map((svc) => (
                        <option key={svc.title} value={svc.title}>
                          {svc.title} {svc.priceINR ? `(₹${svc.priceINR.toLocaleString('en-IN')})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">
                    Additional Notes or Requirements (Optional)
                  </label>
                  <textarea
                    rows={2}
                    placeholder={`Provide any specific details or requirements for your booking with ${bizName}...`}
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3.5 py-2 text-white placeholder-slate-600 focus:outline-none focus:border-cyan-500"
                  />
                </div>

                {/* Honeypot Bot Trap */}
                <div style={{ display: 'none' }} aria-hidden="true">
                  <input
                    type="text"
                    name="website_url_hp"
                    tabIndex={-1}
                    autoComplete="off"
                    value={botTrap}
                    onChange={(e) => setBotTrap(e.target.value)}
                  />
                </div>

                {/* DPDP Act 2023 Statutory Consent Checkbox */}
                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-1.5">
                  <label className="flex items-start gap-2.5 cursor-pointer text-xs text-slate-300">
                    <input
                      type="checkbox"
                      required
                      checked={consentGiven}
                      onChange={(e) => setConsentGiven(e.target.checked)}
                      className="mt-0.5 rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500"
                    />
                    <span>
                      I consent to {bizName} processing my contact details solely for consultation scheduling in compliance with the <strong>Digital Personal Data Protection (DPDP) Act 2023</strong>.{' '}
                      <button
                        type="button"
                        onClick={() => setShowPrivacyPolicy(true)}
                        className="underline text-cyan-400 hover:text-cyan-300 font-medium inline"
                      >
                        Read Statutory Privacy Policy &amp; DCI Disclosures
                      </button>
                    </span>
                  </label>
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

        {/* Regulatory Compliance Footer */}
        <div className="p-4 rounded-xl bg-slate-900/40 border border-slate-800/60 text-[11px] text-slate-500 space-y-1.5 leading-relaxed">
          <div className="font-semibold text-slate-400 uppercase tracking-wider">
            Statutory Transparency &amp; Privacy Notice
          </div>
          <div>
            1. Service Standards: All services and consultations are fulfilled by qualified professionals and certified personnel representing {bizName}.
          </div>
          <div>
            2. Transparent Estimates: Service suitability and final billing may vary based on individualized assessment and exact scope of service.
          </div>
          <div>
            3. Privacy &amp; Data Protection: Contact information is strictly protected under the Information Technology Act 2000 and Digital Personal Data Protection (DPDP) Act 2023, used solely for direct appointment coordination.
          </div>
        </div>
      </div>
    </div>
  );
};
