# 07_public_endpoints.md

### Command: curl.exe -sS -i --max-time 15 "https://ai-marketing-organization.onrender.com/"
UTC Timestamp: 2026-11-08T06:45:27.904Z
```
HTTP/1.1 200 OK
Date: Sun, 08 Nov 2026 06:45:28 GMT
Content-Type: text/html; charset=UTF-8
Transfer-Encoding: chunked
Connection: keep-alive
access-control-allow-credentials: true
access-control-expose-headers: Set-Cookie
cf-cache-status: DYNAMIC
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://*.razorpay.com; frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com; child-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com; connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://lumberjack.razorpay.com https://*.razorpay.com; img-src 'self' data: https: https://*.razorpay.com; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; frame-ancestors 'self'
cross-origin-embedder-policy: unsafe-none
referrer-policy: strict-origin-when-cross-origin
rndr-id: 89cd8e1d-c02e-43b1
Server: cloudflare
strict-transport-security: max-age=31536000; includeSubDomains
vary: Origin
vary: Accept-Encoding
x-content-type-options: nosniff
x-render-origin-server: Render
CF-RAY: a5729d768f7a4844-BOM
alt-svc: h3=":443"; ma=86400

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Administrative Website &amp; WhatsApp Inquiry Capture | AI Marketing Organization</title>
  <meta name="description" content="Turn after-hours patient inquiries into booked appointments. Administrative Website &amp; WhatsApp Inquiry Capture, Instant Triage Summary, and Appointment Request Logging for Indian healthcare and dental practices.">
  <link rel="canonical" href="https://ai-marketing-organization.onrender.com/">
  <meta name="robots" content="index, follow">
  <meta name="cuelinks-verification" content="VERIFY-CL-YE94W8YS" />
  <meta name="google-site-verification" content="WVPs1hLZgUqJL5yO9jwF2pWwsekPcMtTOLLeWILGU9I" />
  <!-- Razorpay Standard Web Checkout -->
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <style>
    :root {
      color-scheme: dark;
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1e293b;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #06b6d4;
      --accent-hover: #22d3ee;
      --warning: #f59e0b;
      --success: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      line-height: 1.6;
    }
    nav.top-nav {
      background: #0b1120;
      border-bottom: 1px solid var(--card-border);
      padding: 1rem 1.5rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 1rem;
    }
    .brand { font-weight: 800; font-size: 1.15rem; color: #fff; text-decoration: none; }
    .nav-links { display: flex; gap: 1.25rem; align-items: center; flex-wrap: wrap; }
    .nav-links a { color: var(--text-muted); text-decoration: none; font-size: 0.9rem; font-weight: 500; }
    .nav-links a:hover, .nav-links a.active { color: var(--accent); }
    .container { max-width: 980px; margin: 0 auto; padding: 2.5rem 1.25rem; }
    .hero { text-align: center; margin-bottom: 3.5rem; }
    .status-badge {
      display: inline-block;
      background: rgba(6, 182, 212, 0.12);
      color: #38bdf8;
      border: 1px solid rgba(6, 182, 212, 0.3);
      padding: 0.35rem 0.9rem;
      border-radius: 999px;
      font-size: 0.82rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      margin-bottom: 1.25rem;
      text-transform: uppercase;
    }
    h1 {
      font-size: 2.5rem;
      font-weight: 800;
      color: #ffffff;
      line-height: 1.2;
      margin-bottom: 1rem;
    }
    p.subtitle {
      font-size: 1.15rem;
      color: var(--text-muted);
      max-width: 760px;
      margin: 0 auto 1.75rem auto;
    }
    .cta-group { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
    .btn {
      display: inline-block;
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      font-weight: 600;
      font-size: 0.95rem;
      text-decoration: none;
      cursor: pointer;
      border: none;
    }
    .btn-primary { background: var(--accent); color: #090d16; }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-secondary { background: #1e293b; color: #fff; border: 1px solid var(--card-border); }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 2rem;
      margin-bottom: 2rem;
    }
    .card h2 { font-size: 1.4rem; color: #fff; margin-bottom: 1rem; }
    .grid-3 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 1.25rem;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
      gap: 1.5rem;
    }
    .feature-item {
      background: #0b1120;
      border: 1px solid var(--card-border);
      border-radius: 10px;
      padding: 1.25rem;
    }
    .feature-item h3 { font-size: 1.1rem; color: #fff; margin-bottom: 0.5rem; }
    .feature-item p { font-size: 0.9rem; color: #cbd5e1; line-height: 1.5; }
    .sample-badge {
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
      padding: 0.25rem 0.6rem;
      border-radius: 6px;
      font-size: 0.78rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    footer {
      background: #0b1120;
      border-top: 1px solid var(--card-border);
      padding: 2.5rem 1.5rem;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.85rem;
    }
    footer a { color: var(--accent); text-decoration: none; }
  </style>
</head>
<body>
  <nav class="top-nav">
    <a href="/" class="brand">AI Marketing Organization</a>
    <div class="nav-links">
      <a href="/" class="active">After-Hours Lead Capture</a>
      <a href="/tools/site-audit">SiteFix AI Audit</a>
      <a href="/offer">Commercial Overview</a>
      <a href="#interactive-demo">Interactive Demo</a>
      <a href="/revenue">Revenue Funnel</a>
      <a href="/deals">Consumer Deals</a>
      <a href="/guides/student-flight-discounts-india">Travel Guides</a>
    </div>
  </nav>

  <div class="container">
    <header class="hero">
      <div class="status-badge">Administrative After-Hours Lead Capture • India First</div>
      <h1>Never Lose Another Evening Customer Inquiry</h1>
      <p class="subtitle">
        Administrative Website &amp; WhatsApp Inquiry Capture, Message Logging, and Callback Request System for local Indian practices, clinics, and professional services.
      </p>
      <div class="cta-group">
        <a href="#interactive-demo" class="btn btn-primary">Try Interactive Demo</a>
        <a href="#inquiry-card" class="btn btn-secondary">Request Practice Walkthrough</a>
      </div>
    </header>

    <!-- The Problem Section -->
    <div class="card">
      <h2>The Problem: The 8 PM to 8 AM Inquiry Gap</h2>
      <p style="color: #cbd5e1; font-size: 1.05rem; margin-bottom: 1.5rem;">
        Indian dental clinics and local practices lose prospective clients every evening because inquiries arrive outside reception working hours.
      </p>
      <div class="grid-3">
        <div class="feature-item">
          <div style="color: #f87171; font-size: 1.3rem; margin-bottom: 0.35rem;">⏰ 8 PM – 8 AM Dark Hours</div>
          <h3>Evening Inquiries Go Unanswered</h3>
          <p>Clients reach out via Google Business Profile and WhatsApp after work. With reception desks closed, messages wait until 10 AM next morning.</p>
        </div>
        <div class="feature-item">
          <div style="color: #fbbf24; font-size: 1.3rem; margin-bottom: 0.35rem;">⚡ Time-Sensitive Inquiries</div>
          <h3>Competitor Leakage</h3>
          <p>Prospective clients reaching out in the evening frequently contact another provider if inquiry response is delayed.</p>
        </div>
        <div class="feature-item">
          <div style="color: #38bdf8; font-size: 1.3rem; margin-bottom: 0.35rem;">📉 High Opportunity Value</div>
          <h3>Practice Revenue Opportunity</h3>
          <p>High-intent consultation inquiries represent substantial clinic value, making prompt after-hours intake and callback logging critical.</p>
        </div>
      </div>
    </div>

    <!-- Defined Deliverables Section -->
    <div class="card">
      <h2>What We Deploy: The 4-Part Administrative Capture Architecture</h2>
      <p style="color: #cbd5e1; font-size: 1rem; margin-bottom: 1.5rem;">
        A complete, turnkey technical deployment integrated into your practice's existing WhatsApp Business and Google Workspace in 5 days.
      </p>
      <div class="grid-2">
        <div class="feature-item">
          <h3 style="color: #38bdf8;">1. 24/7 WhatsApp Instant Away Inquiry Logging</h3>
          <p>Automated sub-60-second response to after-hours WhatsApp inquiries and missed calls with polite office greetings and structured intake logging.</p>
        </div>
        <div class="feature-item">
          <h3 style="color: #34d399;">2. Top 10 Practice Administrative Quick Replies</h3>
          <p>Standardized responses for your practice's top administrative queries: service categories, general fee guidance, consultation timings, and clinic map location.</p>
        </div>
        <div class="feature-item">
          <h3 style="color: #fbbf24;">3. Direct Calendar Callback Request Logging</h3>
          <p>Integrated booking link allowing clients to request a preferred consultation or callback window directly, eliminating receptionist phone ping-pong.</p>
        </div>
        <div class="feature-item">
          <h3 style="color: #a78bfa;">4. Shared Real-Time Inquiry Tracking Sheet</h3>
          <p>Zero extra software license fees. Logged inquiries automatically populate a shared Google Sheet with client name, phone, requested service, and priority tag.</p>
        </div>
      </div>
    </div>

    <!-- Interactive Demonstration with Sample Data Explicitly Labelled -->
    <div class="card" id="interactive-demo">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem;">
        <h2 style="margin: 0;">Interactive Demonstration: Administrative After-Hours Inquiry Capture</h2>
        <span class="sample-badge">[Illustrative Administrative Example — No Clinical or Medical Triage]</span>
      </div>
      <p style="color: #94a3b8; font-size: 0.95rem; margin-bottom: 1.25rem;">
        Experience how an after-hours appointment inquiry is logged in under 30 seconds. Click a sample scenario below to view the simulated conversation:
      </p>

      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1.25rem;">
        <button type="button" class="btn btn-secondary" onclick="switchDemoHome('pain')" id="btn-demo-h-pain" style="background: #0284c7; color: #fff; border-color: #38bdf8; font-size: 0.85rem;">1. Appointment Scheduling Inquiry (Sunday 9:15 PM)</button>
        <button type="button" class="btn btn-secondary" onclick="switchDemoHome('implants')" id="btn-demo-h-implants" style="font-size: 0.85rem;">2. Clinic Location &amp; Hours (Saturday 8:30 PM)</button>
        <button type="button" class="btn btn-secondary" onclick="switchDemoHome('aligners')" id="btn-demo-h-aligners" style="font-size: 0.85rem;">3. Urgent Callback Request (Weekday 10:00 PM)</button>
      </div>

      <div style="background: #0b1120; border: 1px solid var(--card-border); border-radius: 12px; padding: 1.25rem; max-width: 620px; margin: 0 auto; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
        <div style="border-bottom: 1px solid var(--card-border); padding-bottom: 0.75rem; margin-bottom: 1rem; display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div style="width: 36px; height: 36px; border-radius: 50%; background: #0284c7; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #fff;">A</div>
            <div>
              <div style="font-weight: 700; color: #fff; font-size: 0.95rem;">Apex Reception Inquiry Assistant</div>
              <div style="color: #34d399; font-size: 0.75rem;">● Active • Responds in &lt;60s</div>
            </div>
          </div>
          <span style="font-size: 0.75rem; color: #64748b; background: #111827; padding: 0.2rem 0.5rem; border-radius: 4px;">DEMO PREVIEW</span>
        </div>
        <div id="demo-chat-box-home" style="display: flex; flex-direction: column; gap: 0.75rem;"></div>
      </div>
      <p style="text-align: center; color: #64748b; font-size: 0.8rem; margin-top: 1rem;">
        * Notice: [Illustrative Administrative Example — No Clinical or Medical Triage]. The demonstration above simulates administrative message intake, operating hours guidance, and callback request logging. Real client deployments log customer inquiries directly into client-owned spreadsheets with zero medical or diagnostic claims.
      </p>
    </div>

    <!-- Commercial Terms & Pricing Transparency -->
    <div class="card">
      <h2>Transparent Commercial Terms</h2>
      <div class="grid-2">
        <div>
          <h3 style="color: #38bdf8; font-size: 1.2rem; margin-bottom: 0.5rem;">Introductory Pilot Implementation</h3>
          <p style="color: #cbd5e1; font-size: 0.95rem; margin-bottom: 0.75rem;">
            <strong>Setup Investment:</strong> Custom Pilot Pricing — Request Scope &amp; Attested Quote
          </p>
          <p style="color: #94a3b8; font-size: 0.9rem;">
            Includes full workflow configuration, prompt tuning, Google Calendar synchronization, receptionist training, and 14-day handover monitoring.
          </p>
        </div>
        <div>
          <h3 style="color: #34d399; font-size: 1.2rem; margin-bottom: 0.5rem;">Zero Mandatory Third-Party SaaS Fees</h3>
          <p style="color: #cbd5e1; font-size: 0.95rem; margin-bottom: 0.75rem;">
            <strong>100% Free Client-Owned Tools:</strong> Built on your existing free WhatsApp Business application and Google Workspace accounts.
          </p>
          <p style="color: #94a3b8; font-size: 0.9rem;">
            No recurring hidden software licenses. You own all patient records, spreadsheet logs, and calendar schedules directly.
          </p>
        </div>
      </div>
    </div>

    <!-- Genuine Inbound Contact / Enquiry Form -->
    <div class="card" id="inquiry-card">
      <h2>Request System Demonstration For Your Practice</h2>
      <p style="color: #94a3b8; font-size: 0.95rem; margin-bottom: 1.25rem;">
        Submit your practice details for a confidential system demonstration. The owner will review your practice's after-hours setup and provide a tailored walkthrough.
      </p>
      <form id="lead-inquiry-form-home" onsubmit="handleInquirySubmitHome(event)">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
          <div>
            <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">Doctor / Contact Name *</label>
            <input type="text" id="cust-name-h" required placeholder="Dr. Rajesh Sharma" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;">
          </div>
          <div>
            <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">WhatsApp / Mobile Number *</label>
            <input type="tel" id="cust-phone-h" required placeholder="9876543210" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;">
          </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
          <div>
            <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">Clinic / Practice Name &amp; City *</label>
            <input type="text" id="cust-service-h" required placeholder="Apex Dental Clinic, Hyderabad" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;">
          </div>
          <div>
            <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">Email (Optional)</label>
            <input type="email" id="cust-email-h" placeholder="contact@apexdental.com" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;">
          </div>
        </div>
        <div style="margin-bottom: 1.25rem;">
          <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">Primary Inquiry Challenge (e.g. evening patient calls, WhatsApp FAQ automation)</label>
          <textarea id="cust-notes-h" rows="2" placeholder="Patients reaching out after 8 PM wait until next morning. Want instant 24/7 WhatsApp qualification." style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem; font-family: inherit;"></textarea>
        </div>
        <div style="margin-bottom: 1.25rem;">
          <label style="display: flex; align-items: flex-start; gap: 0.5rem; font-size: 0.85rem; color: #cbd5e1; cursor: pointer;">
            <input type="checkbox" id="cust-consent-h" required style="margin-top: 0.2rem; cursor: pointer;">
            <span>I agree that the name and contact number I submit will be used by the owner to respond to this inquiry. Data is kept for 30 days and deleted on request under DPDP Act 2023. See <a href="/privacy" target="_blank" style="color: var(--accent); text-decoration: underline;">/privacy</a>.</span>
          </label>
        </div>
        <div style="position: absolute; left: -9999px; opacity: 0; pointer-events: none;" aria-hidden="true">
          <input type="text" name="website_trap" id="cust-trap-h" tabindex="-1" autocomplete="off" value="">
        </div>
        <button type="submit" id="submit-btn-h" class="btn btn-primary" style="width: 100%; padding: 0.85rem 1.5rem;">
          Request Lead Triage Demonstration
        </button>
        <div id="form-msg-h" style="display: none; margin-top: 1rem; padding: 0.75rem; border-radius: 8px; text-align: center; font-size: 0.9rem;"></div>
      </form>
    </div>

    <!-- Segregated Consumer Affiliate Research & Guides -->
    <div class="card" style="border-color: #334155; background: #0b1120;">
      <h2 style="font-size: 1.2rem; color: #94a3b8; margin-bottom: 0.75rem;">Consumer Research &amp; Flight Guides Directory</h2>
      <p style="color: #64748b; font-size: 0.88rem; margin-bottom: 1rem;">
        In addition to our B2B lead triage consultancy, we publish independently verified consumer price intelligence and student travel guides:
      </p>
      <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
        <a href="/deals" style="background: #111827; border: 1px solid #1e293b; padding: 0.6rem 1rem; border-radius: 8px; color: #38bdf8; text-decoration: none; font-size: 0.85rem;">
          🏷️ Verified Indian Deals Directory &rarr;
        </a>
        <a href="/guides/student-flight-discounts-india" style="background: #111827; border: 1px solid #1e293b; padding: 0.6rem 1rem; border-radius: 8px; color: #38bdf8; text-decoration: none; font-size: 0.85rem;">
          ✈️ Student Flight Baggage &amp; Fare Guide &rarr;
        </a>
        <a href="/revenue" style="background: #111827; border: 1px solid #1e293b; padding: 0.6rem 1rem; border-radius: 8px; color: #38bdf8; text-decoration: none; font-size: 0.85rem;">
          📊 Transparent Public Revenue Funnel &rarr;
        </a>
      </div>
    </div>
  </div>

  <footer>
    <p>&copy; 2026 AI Marketing Organization. All rights reserved.</p>
    <p style="margin-top: 0.5rem; max-width: 780px; margin-left: auto; margin-right: auto; line-height: 1.5; color: #64748b; font-size: 0.8rem;">
      <strong>Statutory Affiliate Disclosure:</strong> Consumer buying guides and promotional deal directories on this platform contain verified affiliate links to partner platforms (Akasa Air, Air India Express, Cleartrip, boAt, Lenovo, Amazon). When visitors make qualifying bookings or purchases through those links, we may receive an affiliate commission at zero additional cost to the purchaser. Our B2B direct lead triage service is a separate professional consulting offering.
    </p>
    <p style="margin-top: 0.75rem;">
      <a href="/privacy">Privacy Policy</a> • <a href="/revenue">Revenue Funnel</a> • <a href="/offer">Service Overview</a> • <a href="/deals">Deals</a> • Contact: Inquiries via Form
    </p>
  </footer>

  <script>
    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
    var demoScenariosHome = {
      pain: {
        time: 'Sunday, 9:15 PM',
        patient: 'Hello, I would like to schedule a routine dental checkup and teeth cleaning consultation for next week after 5:00 PM. Do you have evening slots open?',
        bot: 'Hello, thank you for contacting Apex Dental Reception. Our clinic is currently closed for the evening (office hours: 9:00 AM – 8:00 PM).\n\nI have logged your request for a routine checkup and cleaning consultation next week. Our front desk coordinator will review available evening slots and call you tomorrow morning at 9:30 AM to confirm an appointment time that suits you.\n\nWould you prefer a morning or afternoon callback?',
        slot: 'Tomorrow 9:30 AM - Callback Logged'
      },
      implants: {
        time: 'Saturday, 8:30 PM',
        patient: 'Hello, what are your clinic working hours on weekends and where is your practice located in Hyderabad?',
        bot: 'Hello, thank you for reaching out to Apex Dental Reception!\n\nOur clinic is open Monday through Saturday from 9:00 AM to 8:00 PM, and Sundays by prior appointment from 10:00 AM to 2:00 PM. We are located at Road No. 36, Jubilee Hills, Hyderabad (landmark: opposite Metro Pillar 1420).\n\nWould you like our front-desk team to call you tomorrow morning to assist with booking a consultation?',
        slot: 'Monday 10:00 AM - Inquiry Follow-up'
      },
      aligners: {
        time: 'Weekday, 10:00 PM',
        patient: 'Hi, I have a chipped tooth from sports this evening and need an appointment as early as possible tomorrow morning.',
        bot: 'Hello, thank you for reaching Apex Dental Reception.\n\n[Notice: This automated system records administrative intake requests only and does not provide clinical or medical triage advice.]\n\nI have tagged your callback request as high-priority for our reception team when our desk opens tomorrow at 9:00 AM so they can offer our earliest cancellation or opening. If you are experiencing bleeding or a severe medical emergency, please visit the nearest 24/7 hospital emergency center immediately.',
        slot: 'Tomorrow 9:15 AM - Priority Desk Callback'
      }
    };

    function switchDemoHome(key) {
      var s = demoScenariosHome[key] || demoScenariosHome.pain;
      var tabs = ['pain', 'implants', 'aligners'];
      tabs.forEach(function(t) {
        var el = document.getElementById('btn-demo-h-' + t);
        if (!el) return;
        if (t === key) {
          el.style.background = '#0284c7';
          el.style.color = '#fff';
          el.style.borderColor = '#38bdf8';
        } else {
          el.style.background = '#1e293b';
          el.style.color = '#94a3b8';
          el.style.borderColor = '#334155';
        }
      });

      var box = document.getElementById('demo-chat-box-home');
      if (!box) return;
      box.innerHTML = 
        '<div style="align-self: flex-end; max-width: 85%; background: #065f46; color: #e6fffa; padding: 0.65rem 0.9rem; border-radius: 12px 12px 0 12px; font-size: 0.88rem; line-height: 1.4;">' +
          '<div>' + s.patient + '</div>' +
          '<div style="text-align: right; font-size: 0.72rem; color: #a7f3d0; margin-top: 0.35rem;">' + s.time + ' ✓✓</div>' +
        '</div>' +
        '<div style="align-self: flex-start; max-width: 85%; background: #1e293b; color: #f8fafc; padding: 0.65rem 0.9rem; border-radius: 12px 12px 12px 0; font-size: 0.88rem; line-height: 1.4; border: 1px solid #334155;">' +
          '<div>' + s.bot.replace(/\n/g, '<br>') + '</div>' +
          '<div style="margin-top: 0.6rem; border-top: 1px solid #334155; padding-top: 0.5rem;">' +
            '<a href="#inquiry-card" style="display: inline-block; background: #0284c7; color: #fff; text-decoration: none; padding: 0.35rem 0.7rem; border-radius: 6px; font-size: 0.8rem; font-weight: 600;">Reserve Slot: ' + s.slot + '</a>' +
          '</div>' +
          '<div style="text-align: right; font-size: 0.72rem; color: #94a3b8; margin-top: 0.35rem;">Triage Response in 28s ✓✓</div>' +
        '</div>';
    }
    switchDemoHome('pain');

    async function handleInquirySubmitHome(e) {
      e.preventDefault();
      var btn = document.getElementById('submit-btn-h');
      var msg = document.getElementById('form-msg-h');
      var consent = document.getElementById('cust-consent-h');
      if (!consent || !consent.checked) {
        msg.style.display = 'block';
        msg.style.background = 'rgba(239, 68, 68, 0.15)';
        msg.style.color = '#f87171';
        msg.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        msg.innerText = 'Error: Explicit consent is required to submit an inquiry under DPDP Act.';
        return;
      }

      btn.disabled = true;
      btn.innerText = 'Submitting Request...';
      msg.style.display = 'block';
      msg.style.background = 'rgba(56, 189, 248, 0.15)';
      msg.style.color = '#38bdf8';
      msg.style.border = '1px solid rgba(56, 189, 248, 0.3)';
      msg.innerText = 'Connecting to server...';

      var payload = {
        customerName: document.getElementById('cust-name-h').value.trim(),
        customerPhone: document.getElementById('cust-phone-h').value.trim(),
        customerEmail: (document.getElementById('cust-email-h') || {}).value ? document.getElementById('cust-email-h').value.trim() : undefined,
        serviceOfInterest: document.getElementById('cust-service-h').value.trim(),
        notes: document.getElementById('cust-notes-h').value.trim(),
        website_trap: (document.getElementById('cust-trap-h') || {}).value || '',
        consentGiven: true,
        source: 'homepage_b2b_inquiry',
        channel: 'WHATSAPP'
      };

      try {
        var res = await fetch('/api/v1/offer/inquiry', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        var data = await res.json();
        if (data.success) {
          msg.style.display = 'block';
          msg.style.background = 'rgba(16, 185, 129, 0.15)';
          msg.style.color = '#34d399';
          msg.style.border = '1px solid rgba(16, 185, 129, 0.3)';
          var delCodeNotice = data.deletionCode ? '<br><small style="color:#94a3b8;font-size:0.85rem;display:block;margin-top:0.5rem;">Your DPDP deletion code: <strong style="color:#38bdf8;">' + escapeHtml(data.deletionCode) + '</strong> (keep this to request data deletion)</small>' : '';
          var triageDeliverable = '';
          if (data.structuredTriageRecord) {
            var rec = data.structuredTriageRecord;
            window.__lastIcs = data.calendarIcs;
            window.__lastCsv = data.csvRow;
            triageDeliverable = '<div style="margin-top:1rem;background:#0b1120;border:1px solid #334155;border-radius:8px;padding:1rem;text-align:left;">' +
              '<div style="font-weight:700;color:#38bdf8;margin-bottom:0.4rem;">📋 Immediate Intake Triage Deliverable Generated</div>' +
              '<div style="font-size:0.85rem;color:#cbd5e1;line-height:1.5;">' +
                '<strong>Practice:</strong> ' + escapeHtml(rec.clinicName) + '<br>' +
                '<strong>Contact:</strong> ' + escapeHtml(rec.contactPerson) + ' (' + escapeHtml(rec.phone) + ')<br>' +
                '<strong>Intake Gap Identified:</strong> ' + escapeHtml(rec.intakeGapIdentified) + '<br>' +
                '<strong>Recommended Action:</strong> ' + escapeHtml(rec.recommendedAction) +
              '</div>' +
              '<div style="margin-top:0.75rem;display:flex;gap:0.5rem;flex-wrap:wrap;">' +
                (data.calendarIcs ? '<button type="button" onclick="downloadIcsFile()" style="background:#0284c7;color:#fff;border:none;padding:0.45rem 0.9rem;border-radius:6px;font-size:0.82rem;font-weight:600;cursor:pointer;">📅 Download Appointment Invite (.ics)</button>' : '') +
                (data.csvRow ? '<button type="button" onclick="toggleCsvPreview()" style="background:#1e293b;color:#cbd5e1;border:1px solid #334155;padding:0.45rem 0.9rem;border-radius:6px;font-size:0.82rem;font-weight:600;cursor:pointer;">📊 View CSV Row</button>' : '') +
              '</div>' +
              '<div id="csv-preview-box" style="display:none;margin-top:0.6rem;background:#090d16;padding:0.5rem;border-radius:4px;font-family:monospace;font-size:0.75rem;color:#94a3b8;word-break:break-all;"></div>' +
            '</div>';
          }
          msg.innerHTML = '✓ ' + escapeHtml(data.message || 'Thank you. The owner will review your practice and reach out shortly.') + delCodeNotice + triageDeliverable;
          document.getElementById('lead-inquiry-form-home').reset();
          btn.style.display = 'none';
        } else {
          throw new Error(data.error || 'Submission failed');
        }
      } catch (err) {
        msg.style.display = 'block';
        msg.style.background = 'rgba(239, 68, 68, 0.15)';
        msg.style.color = '#f87171';
        msg.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        msg.innerText = 'Error: ' + err.message;
        btn.disabled = false;
        btn.innerText = 'Request Lead Triage Demonstration';
      }
    }

    function downloadIcsFile() {
      if (!window.__lastIcs) return;
      var blob = new Blob([window.__lastIcs], { type: 'text/calendar;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'consultation-request.ics';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    function toggleCsvPreview() {
      var box = document.getElementById('csv-preview-box');
      if (box && window.__lastCsv) {
        box.style.display = box.style.display === 'none' ? 'block' : 'none';
        box.innerText = window.__lastCsv;
      }
    }
  </script>
</body>
</html>
```

### Command: curl.exe -sS -i --max-time 15 "https://ai-marketing-organization.onrender.com/deals"
UTC Timestamp: 2026-11-08T06:45:28.414Z
```
HTTP/1.1 200 OK
Date: Sun, 08 Nov 2026 06:45:29 GMT
Content-Type: text/html; charset=UTF-8
Transfer-Encoding: chunked
Connection: keep-alive
access-control-allow-credentials: true
access-control-expose-headers: Set-Cookie
cf-cache-status: DYNAMIC
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://*.razorpay.com; frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com; child-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com; connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://lumberjack.razorpay.com https://*.razorpay.com; img-src 'self' data: https: https://*.razorpay.com; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; frame-ancestors 'self'
cross-origin-embedder-policy: unsafe-none
referrer-policy: strict-origin-when-cross-origin
rndr-id: 14937da7-f2a5-4370
Server: cloudflare
strict-transport-security: max-age=31536000; includeSubDomains
vary: Origin
vary: Accept-Encoding
x-content-type-options: nosniff
x-render-origin-server: Render
CF-RAY: a5729d793f15a55b-BOM
alt-svc: h3=":443"; ma=86400

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="cuelinks-verification" content="VERIFY-CL-YE94W8YS">
  <title>Verified Deals &amp; Price Evidence | Verified Deals &amp; Price Evidence</title>
  <meta name="description" content="Independently verified Indian e-commerce deals across boAt, Lenovo, Noise, and Amazon with reference MRP verification, transparent promo codes, and zero price inflation.">
  <link rel="canonical" href="https://ai-marketing-organization.onrender.com/deals">
  <meta name="robots" content="index, follow">
  <meta property="og:title" content="Verified Deals &amp; Price Evidence | Verified Deals &amp; Price Evidence">
  <meta property="og:description" content="Independently verified Indian e-commerce deals across boAt, Lenovo, Noise, and Amazon with reference MRP verification, transparent promo codes, and zero price inflation.">
  <meta property="og:url" content="https://ai-marketing-organization.onrender.com/deals">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="Verified Deals &amp; Price Evidence">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Verified Deals &amp; Price Evidence | Verified Deals &amp; Price Evidence">
  <meta name="twitter:description" content="Independently verified Indian e-commerce deals across boAt, Lenovo, Noise, and Amazon with reference MRP verification, transparent promo codes, and zero price inflation.">
  
  <style>
    :root { color-scheme: dark; --bg: #090d16; --card: #111827; --text: #e2e8f0; --accent: #06b6d4; --border: #1e293b; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); margin: 0; line-height: 1.6; }
    header { border-bottom: 1px solid var(--border); padding: 1.25rem 2rem; display: flex; justify-content: space-between; align-items: center; max-width: 1100px; margin: 0 auto; }
    header a.brand { font-weight: 700; color: #fff; text-decoration: none; font-size: 1.15rem; }
    header nav a { color: #94a3b8; text-decoration: none; font-size: 0.9rem; margin-left: 1.25rem; }
    header nav a:hover, header nav a.active { color: var(--accent); font-weight: 600; }
    main { max-width: 1100px; margin: 2rem auto; padding: 0 1.5rem; }
    .hero { text-align: center; max-width: 760px; margin: 0 auto 2.5rem auto; }
    .hero h1 { font-size: 2.2rem; color: #fff; margin-bottom: 0.5rem; }
    .hero p { color: #94a3b8; font-size: 1rem; }
    .deals-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 1.5rem; margin-bottom: 3rem; }
    .disclosure-box { background: rgba(14, 165, 233, 0.08); border: 1px solid rgba(14, 165, 233, 0.25); border-radius: 12px; padding: 1.25rem; font-size: 0.85rem; color: #94a3b8; margin: 3rem 0; }
    footer { border-top: 1px solid var(--border); padding: 3rem 1.5rem; margin-top: 4rem; text-align: center; font-size: 0.88rem; color: #64748b; }
    footer nav { display: flex; justify-content: center; flex-wrap: wrap; gap: 1.25rem; margin-bottom: 1rem; }
    footer a { color: #94a3b8; text-decoration: none; }
    footer a:hover { color: var(--accent); }
  </style>
</head>
<body>
  <header>
    <a href="/" class="brand">Verified Deals &amp; Price Evidence</a>
    <nav>
      <a href="/deals" class="active">Verified Deals</a>
      <a href="/">Guides</a>
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
    </nav>
  </header>
  <main>
    <div class="hero">
      <span style="display: inline-block; font-size: 0.75rem; font-weight: 700; color: #38bdf8; background: rgba(56, 189, 248, 0.1); border: 1px solid rgba(56, 189, 248, 0.3); padding: 0.25rem 0.75rem; border-radius: 9999px; margin-bottom: 0.75rem;">AUTONOMOUS VERIFICATION ENGINE</span>
      <h1>Curated, Cross-Checked Deals for Indian Buyers</h1>
      <p>Zero inflated discounts. Every promotional price, MRP baseline, and coupon condition is independently corroborated across official Indian merchant stores.</p>
    </div>
    <div class="deals-grid">
      <p class="no-deals-message" style="color: #94a3b8; font-size: 1.1rem; text-align: center; grid-column: 1 / -1; padding: 3rem 1rem;">No currently verified offers are available in this category. Check back later.</p>
    </div>
    <div class="disclosure-box">
      <strong style="color: #e2e8f0;">Independent Verification &amp; Commercial Disclosure:</strong>
      Deals on this page are autonomously cross-checked across authorized Indian retailer stores. Where authorized affiliate agreements exist, qualifying purchases may earn a referral commission at zero additional cost to you. Reference MRP baselines are independently verified.
    </div>
  </main>
  <footer>
    <nav>
      <a href="/deals">Verified Deals</a>
      <a href="/revenue">Revenue Funnel</a>
      <a href="/about">About</a>
      <a href="/contact">Contact</a>
      <a href="/privacy">Privacy Policy</a>
      <a href="/terms">Terms of Service</a>
      <a href="/disclosure">Affiliate Disclosure</a>
    </nav>
    <p>&copy; 2026 Verified Deals &amp; Price Evidence. All rights reserved.</p>
  </footer>
</body>
</html>
```

### Command: curl.exe -sS -i --max-time 15 "https://ai-marketing-organization.onrender.com/offer"
UTC Timestamp: 2026-11-08T06:45:29.340Z
```
HTTP/1.1 200 OK
Date: Sun, 08 Nov 2026 06:45:30 GMT
Content-Type: text/html; charset=UTF-8
Transfer-Encoding: chunked
Connection: keep-alive
access-control-allow-credentials: true
access-control-expose-headers: Set-Cookie
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://*.razorpay.com; frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com; child-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com; connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://lumberjack.razorpay.com https://*.razorpay.com; img-src 'self' data: https: https://*.razorpay.com; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; frame-ancestors 'self'
cross-origin-embedder-policy: unsafe-none
referrer-policy: strict-origin-when-cross-origin
rndr-id: ffd5a570-0d02-4f15
Server: cloudflare
strict-transport-security: max-age=31536000; includeSubDomains
vary: Origin
vary: Accept-Encoding
x-content-type-options: nosniff
x-render-origin-server: Render
cf-cache-status: DYNAMIC
CF-RAY: a5729d7efb233a81-BOM
alt-svc: h3=":443"; ma=86400

<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AI Inbound Lead Conversion System | Service Overview</title>
  <meta name="description" content="Technical overview of the AI Inbound Lead Conversion System for local businesses in India. Commercial configuration pending owner attestation.">
  <link rel="canonical" href="https://ai-marketing-organization.onrender.com/offer">
  <meta name="robots" content="noindex, nofollow">
  <style>
    :root {
      color-scheme: dark;
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1e293b;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --accent: #06b6d4;
      --warning: #f59e0b;
      --success: #10b981;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text-main);
      line-height: 1.6;
      padding: 2rem 1rem;
    }
    .container { max-width: 860px; margin: 0 auto; }
    header { text-align: center; margin-bottom: 2.5rem; }
    .status-badge {
      display: inline-block;
      background: rgba(245, 158, 11, 0.15);
      color: #fbbf24;
      border: 1px solid rgba(245, 158, 11, 0.3);
      padding: 0.4rem 1rem;
      border-radius: 999px;
      font-size: 0.85rem;
      font-weight: 700;
      letter-spacing: 0.05em;
      margin-bottom: 1.25rem;
      text-transform: uppercase;
    }
    h1 {
      font-size: 2.2rem;
      font-weight: 800;
      color: #ffffff;
      line-height: 1.25;
      margin-bottom: 1rem;
    }
    p.subtitle {
      font-size: 1.1rem;
      color: var(--text-muted);
      max-width: 680px;
      margin: 0 auto;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 14px;
      padding: 1.75rem;
      margin-bottom: 1.5rem;
    }
    .card h2 {
      font-size: 1.35rem;
      color: #fff;
      margin-bottom: 1rem;
    }
    .grid-2 {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 1.5rem;
    }
    ul.check-list {
      list-style: none;
    }
    ul.check-list li {
      padding: 0.4rem 0;
      color: #cbd5e1;
      display: flex;
      align-items: flex-start;
      gap: 0.5rem;
    }
    .pending-notice {
      background: rgba(30, 41, 59, 0.6);
      border: 1px dashed #334155;
      border-radius: 10px;
      padding: 1.25rem;
      text-align: center;
      color: var(--text-muted);
      font-size: 0.95rem;
    }
    footer {
      text-align: center;
      margin-top: 3rem;
      padding-top: 1.5rem;
      border-top: 1px solid var(--card-border);
      color: var(--text-muted);
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="status-badge">Configuration Pending Owner Attestation</div>
      <p style="color: #94a3b8; font-size: 0.85rem; margin-top: 0.5rem; margin-bottom: 0.75rem;">Direct online checkout is disabled until commercial terms are attested by the owner.</p>
      <h1>AI Inbound Lead Conversion System</h1>
      <p class="subtitle">24/7 automated inquiry qualification, WhatsApp response bot, and CRM integration architecture for local service businesses in India.</p>
    </header>

    <div class="card">
      <h2>The Problem: The 8 PM to 8 AM Inquiry Gap</h2>
      <p style="color: #cbd5e1; font-size: 1.05rem; line-height: 1.6; margin-bottom: 0.75rem;">
        Local service businesses and Indian dental practices lose prospective clients every day when inquiries arrive outside working hours (8 PM to 8 AM) or when Google Business Profile chat features are shut down. When high-intent prospective customers reach out via online profiles or WhatsApp in the evening, responses often wait until the next morning — by which time they have already contacted a competitor.
      </p>
      <p style="color: #94a3b8; font-size: 0.95rem; line-height: 1.6;">
        Our automated inquiry capture architecture logs new inquiries within minutes and coordinates calendar callbacks without manual messaging delay.
      </p>
    </div>

    <div class="card">
      <h2>Scope of Technical Deliverables</h2>
      <div class="grid-2">
        <div style="background: #0b1120; border: 1px solid var(--card-border); border-radius: 10px; padding: 1.25rem;">
          <h3 style="color: #38bdf8; font-size: 1.05rem; margin-bottom: 0.4rem;">1. 24/7 WhatsApp Instant Away Inquiry Logging</h3>
          <p style="font-size: 0.88rem; color: #cbd5e1; line-height: 1.5;">Sub-60-second response to after-hours customer queries and missed calls with polite office greetings and structured intake logging.</p>
        </div>
        <div style="background: #0b1120; border: 1px solid var(--card-border); border-radius: 10px; padding: 1.25rem;">
          <h3 style="color: #34d399; font-size: 1.05rem; margin-bottom: 0.4rem;">2. Top 10 Practice Administrative Quick Replies</h3>
          <p style="font-size: 0.88rem; color: #cbd5e1; line-height: 1.5;">Standardized responses for your practice's top administrative queries: service categories, general fee guidance, consultation timings, and clinic map location.</p>
        </div>
        <div style="background: #0b1120; border: 1px solid var(--card-border); border-radius: 10px; padding: 1.25rem;">
          <h3 style="color: #fbbf24; font-size: 1.05rem; margin-bottom: 0.4rem;">3. Direct Calendar Callback Request Logging</h3>
          <p style="font-size: 0.88rem; color: #cbd5e1; line-height: 1.5;">Integrated booking link allowing clients to request a preferred consultation or callback window directly, eliminating receptionist phone ping-pong.</p>
        </div>
        <div style="background: #0b1120; border: 1px solid var(--card-border); border-radius: 10px; padding: 1.25rem;">
          <h3 style="color: #a78bfa; font-size: 1.05rem; margin-bottom: 0.4rem;">4. Shared Inquiry Tracking Sheet</h3>
          <p style="font-size: 0.88rem; color: #cbd5e1; line-height: 1.5;">Real-time Google Sheet synchronization. Zero monthly SaaS cost (100% free client-owned tools).</p>
        </div>
      </div>
    </div>

    <!-- Interactive Demonstration with Sample Data Explicitly Labelled -->
    <div class="card" id="interactive-demo-overview">
      <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 1rem;">
        <h2 style="margin: 0;">Interactive Demonstration: Administrative After-Hours Inquiry Capture</h2>
        <span style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3); padding: 0.25rem 0.6rem; border-radius: 6px; font-size: 0.78rem; font-weight: 700; text-transform: uppercase;">[Illustrative Administrative Example — No Clinical or Medical Triage]</span>
      </div>
      <p style="color: #94a3b8; font-size: 0.95rem; margin-bottom: 1.25rem;">
        Simulate how an after-hours appointment inquiry is logged in under 30 seconds:
      </p>

      <div style="display: flex; gap: 0.5rem; flex-wrap: wrap; margin-bottom: 1.25rem;">
        <button type="button" onclick="switchDemoOverview('pain')" id="btn-demo-o-pain" style="background: #0284c7; color: #fff; border: 1px solid #38bdf8; padding: 0.5rem 0.9rem; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer;">1. Appointment Scheduling Inquiry (Sunday 9:15 PM)</button>
        <button type="button" onclick="switchDemoOverview('implants')" id="btn-demo-o-implants" style="background: #1e293b; color: #94a3b8; border: 1px solid #334155; padding: 0.5rem 0.9rem; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer;">2. Clinic Location &amp; Hours (Saturday 8:30 PM)</button>
        <button type="button" onclick="switchDemoOverview('aligners')" id="btn-demo-o-aligners" style="background: #1e293b; color: #94a3b8; border: 1px solid #334155; padding: 0.5rem 0.9rem; border-radius: 8px; font-size: 0.85rem; font-weight: 600; cursor: pointer;">3. Urgent Callback Request (Weekday 10:00 PM)</button>
      </div>

      <div style="background: #0b1120; border: 1px solid var(--card-border); border-radius: 12px; padding: 1.25rem; max-width: 620px; margin: 0 auto; box-shadow: 0 4px 20px rgba(0,0,0,0.5);">
        <div style="border-bottom: 1px solid var(--card-border); padding-bottom: 0.75rem; margin-bottom: 1rem; display: flex; align-items: center; justify-content: space-between;">
          <div style="display: flex; align-items: center; gap: 0.75rem;">
            <div style="width: 36px; height: 36px; border-radius: 50%; background: #0284c7; display: flex; align-items: center; justify-content: center; font-weight: bold; color: #fff;">A</div>
            <div>
              <div style="font-weight: 700; color: #fff; font-size: 0.95rem;">Apex Reception Inquiry Assistant</div>
              <div style="color: #34d399; font-size: 0.75rem;">● Active • Responds in &lt;60s</div>
            </div>
          </div>
          <span style="font-size: 0.75rem; color: #64748b; background: #111827; padding: 0.2rem 0.5rem; border-radius: 4px;">DEMO PREVIEW</span>
        </div>
        <div id="demo-chat-box-overview" style="display: flex; flex-direction: column; gap: 0.75rem;"></div>
      </div>
      <p style="text-align: center; color: #64748b; font-size: 0.8rem; margin-top: 1rem;">
        * Notice: [Illustrative Administrative Example — No Clinical or Medical Triage]. The demonstration above simulates administrative message intake, operating hours guidance, and callback request logging. Real client deployments log customer inquiries directly into client-owned spreadsheets with zero medical or diagnostic claims.
      </p>
    </div>

    <div class="card" id="inquiry-card">
      <h2>Request Lead Triage Demonstration</h2>
      <p style="color: #94a3b8; font-size: 0.95rem; margin-bottom: 1.25rem;">
        Are inquiries falling through the cracks outside clinic hours? Submit your practice details for a confidential system demonstration and architecture walkthrough.
      </p>
      <form id="lead-inquiry-form" onsubmit="handleInquirySubmit(event)">
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
          <div>
            <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">Doctor / Contact Name *</label>
            <input type="text" id="cust-name" required placeholder="Dr. Rajesh Sharma" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;">
          </div>
          <div>
            <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">WhatsApp / Mobile Number *</label>
            <input type="tel" id="cust-phone" required placeholder="9876543210" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;">
          </div>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem; margin-bottom: 1rem;">
          <div>
            <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">Clinic / Practice Name &amp; City *</label>
            <input type="text" id="cust-service" required placeholder="Apex Dental Clinic, Hyderabad" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;">
          </div>
          <div>
            <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">Email (Optional)</label>
            <input type="email" id="cust-email" placeholder="contact@apexdental.com" style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem;">
          </div>
        </div>
        <div style="margin-bottom: 1.25rem;">
          <label style="display: block; font-size: 0.85rem; color: #94a3b8; margin-bottom: 0.25rem;">Primary Inquiry Challenge (e.g. evening patient calls, WhatsApp FAQ automation)</label>
          <textarea id="cust-notes" rows="2" placeholder="Patients reaching out after 8 PM wait until next morning. Want instant 24/7 WhatsApp qualification." style="width: 100%; padding: 0.6rem; border-radius: 8px; border: 1px solid #334155; background: #0b1120; color: #fff; font-size: 0.9rem; font-family: inherit;"></textarea>
        </div>
        <div style="margin-bottom: 1.25rem;">
          <label style="display: flex; align-items: flex-start; gap: 0.5rem; font-size: 0.85rem; color: #cbd5e1; cursor: pointer;">
            <input type="checkbox" id="cust-consent" required style="margin-top: 0.2rem; cursor: pointer;">
            <span>I agree that the name and contact number I submit will be used by the owner to respond to this inquiry. Data is kept for 30 days and deleted on request. See <a href="/privacy" target="_blank" style="color: var(--accent); text-decoration: underline;">/privacy</a>.</span>
          </label>
        </div>
        <div style="position: absolute; left: -9999px; opacity: 0; pointer-events: none;" aria-hidden="true">
          <input type="text" name="website_trap" id="cust-trap" tabindex="-1" autocomplete="off" value="">
        </div>
        <button type="submit" id="submit-btn" style="background: #0284c7; color: #fff; border: none; padding: 0.75rem 1.5rem; border-radius: 8px; font-weight: 600; cursor: pointer; font-size: 0.95rem; width: 100%;">
          Request Lead Triage Demonstration
        </button>
        <div id="form-msg" style="display: none; margin-top: 1rem; padding: 0.75rem; border-radius: 8px; text-align: center; font-size: 0.9rem;"></div>
      </form>
    </div>

    <!-- Segregated Consumer Affiliate Links -->
    <div class="card" style="border-color: #334155; background: #0b1120;">
      <h3 style="font-size: 1.1rem; color: #94a3b8; margin-bottom: 0.5rem;">Consumer Deals &amp; Travel Guides Directory</h3>
      <p style="color: #64748b; font-size: 0.85rem; margin-bottom: 0.75rem;">
        Explore our independent consumer price intelligence and student travel guides:
      </p>
      <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
        <a href="/deals" style="color: #38bdf8; font-size: 0.88rem; text-decoration: none;">🏷️ Verified Consumer Deals &rarr;</a>
        <a href="/guides/student-flight-discounts-india" style="color: #38bdf8; font-size: 0.88rem; text-decoration: none;">✈️ Student Flight Baggage Guide &rarr;</a>
        <a href="/revenue" style="color: #38bdf8; font-size: 0.88rem; text-decoration: none;">📊 Public Revenue Funnel &rarr;</a>
      </div>
    </div>

    <div class="card">
      <h2>Contact & Commercial Verification</h2>
      <p style="color: #cbd5e1; font-size: 0.95rem;">
        Owner contact email is currently pending configuration.
      </p>
    </div>

    <footer>
      <p>&copy; 2026 AI Marketing Organization. All rights reserved.</p>
      <p style="margin-top: 0.35rem;">Technical overview page • Not an offer to contract until terms are owner-attested. • <a href="/privacy" style="color: var(--text-muted); text-decoration: underline;">Privacy Policy</a> • <a href="/deals" style="color: var(--text-muted); text-decoration: underline;">Deals</a> • <a href="/revenue" style="color: var(--text-muted); text-decoration: underline;">Revenue Funnel</a></p>
    </footer>
  </div>

  <script>
    function escapeHtml(str) {
      if (str === null || str === undefined) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
    var demoScenariosOverview = {
      pain: {
        time: 'Sunday, 9:15 PM',
        patient: 'Hello, I would like to schedule a routine dental checkup and teeth cleaning consultation for next week after 5:00 PM. Do you have evening slots open?',
        bot: 'Hello, thank you for contacting Apex Dental Reception. Our clinic is currently closed for the evening (office hours: 9:00 AM – 8:00 PM).\n\nI have logged your request for a routine checkup and cleaning consultation next week. Our front desk coordinator will review available evening slots and call you tomorrow morning at 9:30 AM to confirm an appointment time that suits you.\n\nWould you prefer a morning or afternoon callback?',
        slot: 'Tomorrow 9:30 AM - Callback Logged'
      },
      implants: {
        time: 'Saturday, 8:30 PM',
        patient: 'Hello, what are your clinic working hours on weekends and where is your practice located in Hyderabad?',
        bot: 'Hello, thank you for reaching out to Apex Dental Reception!\n\nOur clinic is open Monday through Saturday from 9:00 AM to 8:00 PM, and Sundays by prior appointment from 10:00 AM to 2:00 PM. We are located at Road No. 36, Jubilee Hills, Hyderabad (landmark: opposite Metro Pillar 1420).\n\nWould you like our front-desk team to call you tomorrow morning to assist with booking a consultation?',
        slot: 'Monday 10:00 AM - Inquiry Follow-up'
      },
      aligners: {
        time: 'Weekday, 10:00 PM',
        patient: 'Hi, I have a chipped tooth from sports this evening and need an appointment as early as possible tomorrow morning.',
        bot: 'Hello, thank you for reaching Apex Dental Reception.\n\n[Notice: This automated system records administrative intake requests only and does not provide clinical or medical triage advice.]\n\nI have tagged your callback request as high-priority for our reception team when our desk opens tomorrow at 9:00 AM so they can offer our earliest cancellation or opening. If you are experiencing bleeding or a severe medical emergency, please visit the nearest 24/7 hospital emergency center immediately.',
        slot: 'Tomorrow 9:15 AM - Priority Desk Callback'
      }
    };

    function switchDemoOverview(key) {
      var s = demoScenariosOverview[key] || demoScenariosOverview.pain;
      var tabs = ['pain', 'implants', 'aligners'];
      tabs.forEach(function(t) {
        var el = document.getElementById('btn-demo-o-' + t);
        if (!el) return;
        if (t === key) {
          el.style.background = '#0284c7';
          el.style.color = '#fff';
          el.style.borderColor = '#38bdf8';
        } else {
          el.style.background = '#1e293b';
          el.style.color = '#94a3b8';
          el.style.borderColor = '#334155';
        }
      });

      var box = document.getElementById('demo-chat-box-overview');
      if (!box) return;
      box.innerHTML = 
        '<div style="align-self: flex-end; max-width: 85%; background: #065f46; color: #e6fffa; padding: 0.65rem 0.9rem; border-radius: 12px 12px 0 12px; font-size: 0.88rem; line-height: 1.4;">' +
          '<div>' + s.patient + '</div>' +
          '<div style="text-align: right; font-size: 0.72rem; color: #a7f3d0; margin-top: 0.35rem;">' + s.time + ' ✓✓</div>' +
        '</div>' +
        '<div style="align-self: flex-start; max-width: 85%; background: #1e293b; color: #f8fafc; padding: 0.65rem 0.9rem; border-radius: 12px 12px 12px 0; font-size: 0.88rem; line-height: 1.4; border: 1px solid #334155;">' +
          '<div>' + s.bot.replace(/\n/g, '<br>') + '</div>' +
          '<div style="margin-top: 0.6rem; border-top: 1px solid #334155; padding-top: 0.5rem;">' +
            '<a href="#inquiry-card" style="display: inline-block; background: #0284c7; color: #fff; text-decoration: none; padding: 0.35rem 0.7rem; border-radius: 6px; font-size: 0.8rem; font-weight: 600;">Reserve Slot: ' + s.slot + '</a>' +
          '</div>' +
          '<div style="text-align: right; font-size: 0.72rem; color: #94a3b8; margin-top: 0.35rem;">Triage Response in 28s ✓✓</div>' +
        '</div>';
    }
    switchDemoOverview('pain');

    async function handleInquirySubmit(e) {
      e.preventDefault();
      var btn = document.getElementById('submit-btn');
      var msg = document.getElementById('form-msg');
      var consent = document.getElementById('cust-consent');
      if (!consent || !consent.checked) {
        msg.style.display = 'block';
        msg.style.background = 'rgba(239, 68, 68, 0.15)';
        msg.style.color = '#f87171';
        msg.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        msg.innerText = 'Error: Explicit consent is required to submit an inquiry.';
        return;
      }

      btn.disabled = true;
      btn.innerText = 'Sending...';
      msg.style.display = 'block';
      msg.style.background = 'rgba(56, 189, 248, 0.15)';
      msg.style.color = '#38bdf8';
      msg.style.border = '1px solid rgba(56, 189, 248, 0.3)';
      msg.innerText = 'Connecting to server...';

      var payload = {
        customerName: document.getElementById('cust-name').value.trim(),
        customerPhone: document.getElementById('cust-phone').value.trim(),
        customerEmail: document.getElementById('cust-email').value.trim() || undefined,
        serviceOfInterest: document.getElementById('cust-service').value.trim(),
        notes: document.getElementById('cust-notes').value.trim(),
        website_trap: (document.getElementById('cust-trap') || {}).value || '',
        consentGiven: true,
        source: 'offer_page_inquiry',
        channel: 'WHATSAPP'
      };

      async function doFetchWithTimeout(timeoutMs) {
        var controller = new AbortController();
        var timer = setTimeout(function() { controller.abort(); }, timeoutMs);
        try {
          var response = await fetch('/api/v1/offer/inquiry', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            signal: controller.signal
          });
          clearTimeout(timer);
          return response;
        } catch (err) {
          clearTimeout(timer);
          throw err;
        }
      }

      try {
        var res;
        try {
          res = await doFetchWithTimeout(15000);
        } catch (fetchErr) {
          msg.innerText = 'Server is waking up (takes ~30s on free tier). Retrying...';
          res = await doFetchWithTimeout(35000);
        }

        var data = await res.json();
        if (data.success) {
          msg.style.display = 'block';
          msg.style.background = 'rgba(16, 185, 129, 0.15)';
          msg.style.color = '#34d399';
          msg.style.border = '1px solid rgba(16, 185, 129, 0.3)';
          var delCodeNotice = data.deletionCode ? '<br><small style="color:#94a3b8;font-size:0.85rem;display:block;margin-top:0.5rem;">Your DPDP deletion code: <strong style="color:#38bdf8;">' + escapeHtml(data.deletionCode) + '</strong> (keep this to request data deletion)</small>' : '';
          var triageDeliverable = '';
          if (data.structuredTriageRecord) {
            var rec = data.structuredTriageRecord;
            window.__lastIcs = data.calendarIcs;
            window.__lastCsv = data.csvRow;
            triageDeliverable = '<div style="margin-top:1rem;background:#0b1120;border:1px solid #334155;border-radius:8px;padding:1rem;text-align:left;">' +
              '<div style="font-weight:700;color:#38bdf8;margin-bottom:0.4rem;">📋 Immediate Intake Triage Deliverable Generated</div>' +
              '<div style="font-size:0.85rem;color:#cbd5e1;line-height:1.5;">' +
                '<strong>Practice:</strong> ' + escapeHtml(rec.clinicName) + '<br>' +
                '<strong>Contact:</strong> ' + escapeHtml(rec.contactPerson) + ' (' + escapeHtml(rec.phone) + ')<br>' +
                '<strong>Intake Gap Identified:</strong> ' + escapeHtml(rec.intakeGapIdentified) + '<br>' +
                '<strong>Recommended Action:</strong> ' + escapeHtml(rec.recommendedAction) +
              '</div>' +
              '<div style="margin-top:0.75rem;display:flex;gap:0.5rem;flex-wrap:wrap;">' +
                (data.calendarIcs ? '<button type="button" onclick="downloadIcsFile()" style="background:#0284c7;color:#fff;border:none;padding:0.45rem 0.9rem;border-radius:6px;font-size:0.82rem;font-weight:600;cursor:pointer;">📅 Download Appointment Invite (.ics)</button>' : '') +
                (data.csvRow ? '<button type="button" onclick="toggleCsvPreview()" style="background:#1e293b;color:#cbd5e1;border:1px solid #334155;padding:0.45rem 0.9rem;border-radius:6px;font-size:0.82rem;font-weight:600;cursor:pointer;">📊 View CSV Row</button>' : '') +
              '</div>' +
              '<div id="csv-preview-box" style="display:none;margin-top:0.6rem;background:#090d16;padding:0.5rem;border-radius:4px;font-family:monospace;font-size:0.75rem;color:#94a3b8;word-break:break-all;"></div>' +
            '</div>';
          }
          msg.innerHTML = '✓ ' + escapeHtml(data.message || 'Thank you. The owner will contact you on the number you gave.') + delCodeNotice + triageDeliverable;
          document.getElementById('lead-inquiry-form').reset();
          btn.style.display = 'none';
        } else {
          throw new Error(data.error || 'Submission failed');
        }
      } catch (err) {
        msg.style.display = 'block';
        msg.style.background = 'rgba(239, 68, 68, 0.15)';
        msg.style.color = '#f87171';
        msg.style.border = '1px solid rgba(239, 68, 68, 0.3)';
        msg.innerText = 'Error: ' + err.message;
        btn.disabled = false;
        btn.innerText = 'Request Lead Triage Demonstration';
      }
    }

    try {
      if (typeof window !== 'undefined' && window.location) {
        var params = new URLSearchParams(window.location.search);
        if (params.get('test') === 'true') {
          var elName = document.getElementById('cust-name');
          var elPhone = document.getElementById('cust-phone');
          var elSvc = document.getElementById('cust-service');
          var elNotes = document.getElementById('cust-notes');
          var elConsent = document.getElementById('cust-consent');
          if (elName) elName.value = 'Dr. Smoke Test (TEST)';
          if (elPhone) elPhone.value = '9999988888';
          if (elSvc) elSvc.value = 'Smoke Test Clinic, Hyderabad';
          if (elNotes) elNotes.value = 'Owner end-to-end smoke test inquiry';
          if (elConsent) elConsent.checked = true;
        }
      }
    } catch (e) {}

    try {
      fetch('/api/v1/referrals/beacon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          placement: 'offer_page_view',
          source: 'direct_offer_overview',
          contentSlug: 'offer'
        })
      }).catch(function() {});
    function downloadIcsFile() {
      if (!window.__lastIcs) return;
      var blob = new Blob([window.__lastIcs], { type: 'text/calendar;charset=utf-8' });
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'consultation-request.ics';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }

    function toggleCsvPreview() {
      var box = document.getElementById('csv-preview-box');
      if (box && window.__lastCsv) {
        box.style.display = box.style.display === 'none' ? 'block' : 'none';
        box.innerText = window.__lastCsv;
      }
    }
  </script>
</body>
</html>
```

### Command: curl.exe -sS -i --max-time 15 "https://ai-marketing-organization.onrender.com/sitemap.xml"
UTC Timestamp: 2026-11-08T06:45:30.232Z
```
HTTP/1.1 200 OK
Date: Sun, 08 Nov 2026 06:45:35 GMT
Content-Type: application/xml; charset=utf-8
Transfer-Encoding: chunked
Connection: keep-alive
access-control-allow-credentials: true
access-control-expose-headers: Set-Cookie
cf-cache-status: DYNAMIC
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://*.razorpay.com; frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com; child-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com; connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://lumberjack.razorpay.com https://*.razorpay.com; img-src 'self' data: https: https://*.razorpay.com; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; frame-ancestors 'self'
cross-origin-embedder-policy: unsafe-none
referrer-policy: strict-origin-when-cross-origin
rndr-id: f85c2c4f-3bb6-4efc
Server: cloudflare
strict-transport-security: max-age=31536000; includeSubDomains
vary: Origin
vary: Accept-Encoding
x-content-type-options: nosniff
x-render-origin-server: Render
CF-RAY: a5729d847f663b97-BOM
alt-svc: h3=":443"; ma=86400

<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://ai-marketing-organization.onrender.com/</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://ai-marketing-organization.onrender.com/offer</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://ai-marketing-organization.onrender.com/tools/site-audit</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://ai-marketing-organization.onrender.com/tools/lead-leakage-calculator</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://ai-marketing-organization.onrender.com/deals</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://ai-marketing-organization.onrender.com/revenue</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://ai-marketing-organization.onrender.com/public/disclosure</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://ai-marketing-organization.onrender.com/guides/student-flight-discounts-india</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
  <url>
    <loc>https://ai-marketing-organization.onrender.com/audit/capturelifedentalcare.com</loc>
    <changefreq>daily</changefreq>
    <priority>0.8</priority>
  </url>
</urlset>
```

### Command: curl.exe -sS -i --max-time 15 "https://ai-marketing-organization.onrender.com/robots.txt"
UTC Timestamp: 2026-11-08T06:45:34.669Z
```
HTTP/1.1 200 OK
Date: Sun, 08 Nov 2026 06:45:35 GMT
Content-Type: text/plain; charset=utf-8
Transfer-Encoding: chunked
Connection: keep-alive
access-control-allow-credentials: true
access-control-expose-headers: Set-Cookie
cf-cache-status: DYNAMIC
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://*.razorpay.com; frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com; child-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com; connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://lumberjack.razorpay.com https://*.razorpay.com; img-src 'self' data: https: https://*.razorpay.com; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; frame-ancestors 'self'
cross-origin-embedder-policy: unsafe-none
referrer-policy: strict-origin-when-cross-origin
rndr-id: e17e4d35-5997-4ca4
Server: cloudflare
strict-transport-security: max-age=31536000; includeSubDomains
vary: Origin
vary: Accept-Encoding
x-content-type-options: nosniff
x-render-origin-server: Render
CF-RAY: a5729da0693349a6-BOM
alt-svc: h3=":443"; ma=86400

User-agent: *
Allow: /
Disallow: /api/v1/auth/
Disallow: /admin
Sitemap: https://ai-marketing-organization.onrender.com/sitemap.xml
```

### Command: curl.exe -sS -i --max-time 15 "https://ai-marketing-organization.onrender.com/api/v1/system/readiness"
UTC Timestamp: 2026-11-08T06:45:35.105Z
```
HTTP/1.1 401 Unauthorized
Date: Sun, 08 Nov 2026 06:45:36 GMT
Content-Type: application/json
Transfer-Encoding: chunked
Connection: keep-alive
access-control-allow-credentials: true
access-control-expose-headers: Set-Cookie
cf-cache-status: DYNAMIC
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://*.razorpay.com; frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com; child-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com; connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://lumberjack.razorpay.com https://*.razorpay.com; img-src 'self' data: https: https://*.razorpay.com; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; frame-ancestors 'self'
cross-origin-embedder-policy: unsafe-none
referrer-policy: strict-origin-when-cross-origin
rndr-id: f19401f6-875c-4529
Server: cloudflare
strict-transport-security: max-age=31536000; includeSubDomains
vary: Origin
vary: Accept-Encoding
x-content-type-options: nosniff
x-render-origin-server: Render
CF-RAY: a5729da32fa047f0-BOM
alt-svc: h3=":443"; ma=86400

{"success":false,"error":"Unauthorized: In production, an authenticated principal is required via Bearer token or x-api-key. Client identity headers alone are rejected."}
```

### Command: curl.exe -sS -i --max-time 15 "https://ai-marketing-organization.onrender.com/api/v1/cron/status"
UTC Timestamp: 2026-11-08T06:45:35.538Z
```
HTTP/1.1 200 OK
Date: Sun, 08 Nov 2026 06:45:43 GMT
Content-Type: application/json
Transfer-Encoding: chunked
Connection: keep-alive
access-control-allow-credentials: true
access-control-expose-headers: Set-Cookie
cf-cache-status: DYNAMIC
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://*.razorpay.com; frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com; child-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com; connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://lumberjack.razorpay.com https://*.razorpay.com; img-src 'self' data: https: https://*.razorpay.com; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; frame-ancestors 'self'
cross-origin-embedder-policy: unsafe-none
referrer-policy: strict-origin-when-cross-origin
rndr-id: 11e1d83c-f0d3-44b4
Server: cloudflare
strict-transport-security: max-age=31536000; includeSubDomains
vary: Origin
vary: Accept-Encoding
x-content-type-options: nosniff
x-render-origin-server: Render
CF-RAY: a5729da5cd7780b8-BOM
alt-svc: h3=":443"; ma=86400

{"success":true,"data":{"status":"PARTIAL","triggerAccepted":true,"heartbeatAgeMinutes":22,"cronExpression":"0 * * * *","cadenceMinutes":60,"totalPings":1103,"totalLifetimePings":1103,"recentPings24h":0,"lastObservedPing":"2026-11-08 06:23:12","lastSuccessfulCycle":"2026-11-08 06:02:10","lastFailedCycle":"2026-09-29 22:33:49","cycleResult":"SUCCESS","lastUserAgent":"curl/8.18.0","workerSource":"curl/8.18.0","queueStatus":{"queued":20,"running":0,"completed":152,"completedWithFindings":0,"noActionDue":634,"partial":0,"deferred":0,"blocked":0,"retryWait":0,"failedPermanently":0,"failedTotal":0,"expiredLeases":0,"overdueCount":20,"oldestOverdueAgeMinutes":883,"oldestQueuedAgeMinutes":883,"lastSuccessfulExecutionAt":"2026-11-08 06:02:09"},"businessOutcome":{"totalWorkflows":20,"hasBlocked":false,"hasError":false,"hasPartial":false,"overdueCount":20,"oldestOverdueAgeMinutes":883},"metrics":{"scheduledWakeUps":1103,"successfulOrchestrationCycles":1155,"discoveryAttempts":30,"successfulProviderQueries":30,"evidenceBackedSignals":0,"qualifiedProspects":0,"contentTasks":1,"ownerApprovalsPending":0,"publishedAssets":1,"customerInquiries":0,"proposals":0,"paymentAttempts":0,"verifiedRevenueINR":0,"bankConfirmedCashINR":0,"paidAcquisitionSpendINR":0,"idleCycles":681,"idleCycleSharePercent":54,"isIdle":false}}}
```

### Command: curl.exe -sS -i --max-time 15 "https://ai-marketing-organization.onrender.com/api/v1/public/autonomy-status"
UTC Timestamp: 2026-11-08T06:45:43.391Z
```
HTTP/1.1 200 OK
Date: Sun, 08 Nov 2026 06:45:49 GMT
Content-Type: application/json
Transfer-Encoding: chunked
Connection: keep-alive
access-control-allow-credentials: true
access-control-expose-headers: Set-Cookie
cf-cache-status: DYNAMIC
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://*.razorpay.com; frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com; child-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com; connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://lumberjack.razorpay.com https://*.razorpay.com; img-src 'self' data: https: https://*.razorpay.com; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; frame-ancestors 'self'
cross-origin-embedder-policy: unsafe-none
referrer-policy: strict-origin-when-cross-origin
rndr-id: dad0f979-bfed-4c1c
Server: cloudflare
strict-transport-security: max-age=31536000; includeSubDomains
vary: Origin
vary: Accept-Encoding
x-content-type-options: nosniff
x-render-origin-server: Render
CF-RAY: a5729dd70fc697f6-BOM
alt-svc: h3=":443"; ma=86400

{"version":"5.8.4","platform":"Autonomous Multi-Sector Revenue Organization","timestamp":"2026-11-08T06:45:49.396Z","buildMetadata":{"version":"5.8.4","gitCommit":"b4ee6e5fc58960de48dfa61fa79aff20d5f83e17","deployedCommitSha":"b4ee6e5fc58960de48dfa61fa79aff20d5f83e17","cloudflareWorkerStatus":{"status":"OBSERVED","lastObservedPing":"2026-11-08 06:23:12","lastUserAgent":"curl/8.18.0"},"cloudflareWorkerVersion":"curl/8.18.0","d1MigrationVersion":"0049","runtimeVerifiedAt":"2026-11-08T06:45:49.396Z"},"policyGate":{"version":"v5.4.0","humanReviewGate":"STRICT_ENFORCED","autonomousApprovalsAllowed":["PUBLISH_VERIFIED_DEAL","TRIGGER_PAGESPEED_AUDIT","SUBMIT_SEARCH_INDEXING","REFRESH_SITEMAP_CONTENT","UPDATE_EXPLORATION_BANDIT"],"humanGatedActions":["OUTBOUND_COLD_MESSAGING","FINANCIAL_SPEND_DEBIT","MODIFY_STATUTORY_DISCLOSURE","EXECUTE_BINDING_CONTRACT"],"paidSpendBlocked":true,"paidSpendApprovedINR":0},"paymentReadiness":{"sandboxTestReady":true,"liveMoneyReady":false,"paymentMode":"SANDBOX","ownerOfferAttested":true,"gatewayCredentialStatus":"VERIFIED_TEST","missingConfiguration":[]},"recentWorkflowExecutions24h":{"totalExecutions":87,"completed":37,"completedWithFindings":0,"completedNoFindings":0,"noActionDue":50,"partial":0,"blocked":0,"deferred":0,"pausedQuota":0,"error":0,"notImplemented":0},"quotaLedger":{"google_custom_search":{"windowKey":"2026-11-07","windowType":"PT_DAY","cap":60,"safetyReserve":10,"used":0,"reserved":0,"remaining":60,"circuitBreaker":"CLOSED","configuredStatus":"CONFIGURED"},"google_suggest":{"windowKey":"2026-11-08","windowType":"UTC_DAY","cap":80,"safetyReserve":8,"used":12,"reserved":0,"remaining":68,"circuitBreaker":"CLOSED","configuredStatus":"CONFIGURED"},"google_pagespeed":{"windowKey":"2026-11-07","windowType":"PT_DAY","cap":40,"safetyReserve":5,"used":0,"reserved":0,"remaining":40,"circuitBreaker":"CLOSED","configuredStatus":"UNCONFIGURED_KEYLESS_MODE"},"google_indexing":{"windowKey":"2026-11-07","windowType":"PT_DAY","cap":180,"safetyReserve":20,"used":0,"reserved":0,"remaining":180,"circuitBreaker":"CLOSED","configuredStatus":"CONFIGURED"},"gemini_flash":{"windowKey":"2026-11-07","windowType":"PT_DAY","cap":48,"safetyReserve":5,"used":0,"reserved":0,"remaining":48,"circuitBreaker":"CLOSED","configuredStatus":"CONFIGURED"},"brevo_mcp":{"windowKey":"2026-11-08","windowType":"UTC_DAY","cap":200,"safetyReserve":20,"used":0,"reserved":0,"remaining":200,"circuitBreaker":"CLOSED","configuredStatus":"CONFIGURED"},"tavily_search":{"windowKey":"2026-11","windowType":"UTC_MONTH","cap":750,"safetyReserve":50,"used":0,"reserved":0,"remaining":750,"circuitBreaker":"CLOSED","configuredStatus":"CONFIGURED"},"cuelinks_v3":{"windowKey":"2026-11-08T06","windowType":"UTC_HOUR","cap":1,"safetyReserve":0,"used":0,"reserved":0,"remaining":1,"circuitBreaker":"CLOSED","configuredStatus":"CONFIGURED"}},"sectorIntelligence":{"SECTOR_A_PRECIOUS_METALS":{"sectorCode":"SECTOR_A_PRECIOUS_METALS","displayName":"Gold & Jewellery","alpha":1,"beta":1,"cumulativeReward":0,"verifiedHumanInteractions":0,"conversionsCount":0,"inColdStart":true,"allocationWeight":0.125,"lastUpdated":"2026-11-08T06:24:47.819Z"},"SECTOR_B_ELECTRONICS":{"sectorCode":"SECTOR_B_ELECTRONICS","displayName":"Electronics & Tech","alpha":1,"beta":1,"cumulativeReward":0,"verifiedHumanInteractions":0,"conversionsCount":0,"inColdStart":true,"allocationWeight":0.125,"lastUpdated":"2026-11-08T06:24:47.821Z"},"SECTOR_C_HOME_APPLIANCES":{"sectorCode":"SECTOR_C_HOME_APPLIANCES","displayName":"Home & Appliances","alpha":1,"beta":1,"cumulativeReward":0,"verifiedHumanInteractions":0,"conversionsCount":0,"inColdStart":true,"allocationWeight":0.125,"lastUpdated":"2026-11-08T06:24:47.822Z"},"SECTOR_D_TRAVEL":{"sectorCode":"SECTOR_D_TRAVEL","displayName":"Travel & Flights","alpha":1,"beta":1,"cumulativeReward":0,"verifiedHumanInteractions":0,"conversionsCount":0,"inColdStart":true,"allocationWeight":0.125,"lastUpdated":"2026-11-08T06:24:47.824Z"},"SECTOR_E_SOFTWARE":{"sectorCode":"SECTOR_E_SOFTWARE","displayName":"Software & SaaS","alpha":1,"beta":1,"cumulativeReward":0,"verifiedHumanInteractions":0,"conversionsCount":0,"inColdStart":true,"allocationWeight":0.125,"lastUpdated":"2026-11-08T06:24:47.825Z"},"SECTOR_F_OFFICE_INDUSTRIAL":{"sectorCode":"SECTOR_F_OFFICE_INDUSTRIAL","displayName":"Office & Industrial","alpha":1,"beta":1,"cumulativeReward":0,"verifiedHumanInteractions":0,"conversionsCount":0,"inColdStart":true,"allocationWeight":0.125,"lastUpdated":"2026-11-08T06:24:47.827Z"},"SECTOR_G_LIFESTYLE":{"sectorCode":"SECTOR_G_LIFESTYLE","displayName":"Lifestyle & Fashion","alpha":1,"beta":1,"cumulativeReward":0,"verifiedHumanInteractions":0,"conversionsCount":0,"inColdStart":true,"allocationWeight":0.125,"lastUpdated":"2026-11-08T06:24:47.829Z"},"SECTOR_H_LOCAL_SERVICES_B2B":{"sectorCode":"SECTOR_H_LOCAL_SERVICES_B2B","displayName":"Local B2B & Clinics","alpha":1,"beta":1,"cumulativeReward":0,"verifiedHumanInteractions":0,"conversionsCount":0,"inColdStart":true,"allocationWeight":0.125,"lastUpdated":"2026-11-08T06:24:47.830Z"}},"banditLearning":{"SECTOR_A_PRECIOUS_METALS":{"sectorCode":"SECTOR_A_PRECIOUS_METALS","displayName":"Gold & Jewellery","alpha":1,"beta":1,"cumulativeReward":0,"verifiedHumanInteractions":0,"conversionsCount":0,"inColdStart":true,"allocationWeight":0.125,"lastUpdated":"2026-11-08T06:24:47.819Z"},"SECTOR_B_ELECTRONICS":{"sectorCode":"SECTOR_B_ELECTRONICS","displayName":"Electronics & Tech","alpha":1,"beta":1,"cumulativeReward":0,"verifiedHumanInteractions":0,"conversionsCount":0,"inColdStart":true,"allocationWeight":0.125,"lastUpdated":"2026-11-08T06:24:47.821Z"},"SECTOR_C_HOME_APPLIANCES":{"sectorCode":"SECTOR_C_HOME_APPLIANCES","displayName":"Home & Appliances","alpha":1,"beta":1,"cumulativeReward":0,"verifiedHumanInteractions":0,"conversionsCount":0,"inColdStart":true,"allocationWeight":0.125,"lastUpdated":"2026-11-08T06:24:47.822Z"},"SECTOR_D_TRAVEL":{"sectorCode":"SECTOR_D_TRAVEL","displayName":"Travel & Flights","alpha":1,"beta":1,"cumulativeReward":0,"verifiedHumanInteractions":0,"conversionsCount":0,"inColdStart":true,"allocationWeight":0.125,"lastUpdated":"2026-11-08T06:24:47.824Z"},"SECTOR_E_SOFTWARE":{"sectorCode":"SECTOR_E_SOFTWARE","displayName":"Software & SaaS","alpha":1,"beta":1,"cumulativeReward":0,"verifiedHumanInteractions":0,"conversionsCount":0,"inColdStart":true,"allocationWeight":0.125,"lastUpdated":"2026-11-08T06:24:47.825Z"},"SECTOR_F_OFFICE_INDUSTRIAL":{"sectorCode":"SECTOR_F_OFFICE_INDUSTRIAL","displayName":"Office & Industrial","alpha":1,"beta":1,"cumulativeReward":0,"verifiedHumanInteractions":0,"conversionsCount":0,"inColdStart":true,"allocationWeight":0.125,"lastUpdated":"2026-11-08T06:24:47.827Z"},"SECTOR_G_LIFESTYLE":{"sectorCode":"SECTOR_G_LIFESTYLE","displayName":"Lifestyle & Fashion","alpha":1,"beta":1,"cumulativeReward":0,"verifiedHumanInteractions":0,"conversionsCount":0,"inColdStart":true,"allocationWeight":0.125,"lastUpdated":"2026-11-08T06:24:47.829Z"},"SECTOR_H_LOCAL_SERVICES_B2B":{"sectorCode":"SECTOR_H_LOCAL_SERVICES_B2B","displayName":"Local B2B & Clinics","alpha":1,"beta":1,"cumulativeReward":0,"verifiedHumanInteractions":0,"conversionsCount":0,"inColdStart":true,"allocationWeight":0.125,"lastUpdated":"2026-11-08T06:24:47.830Z"}},"capabilityMatrix":{"searchDiscovery":{"provider":"SearchDiscoveryProvider","hierarchy":["CACHE_24H","GOOGLE_CUSTOM_SEARCH_60_DAY","TAVILY_SEARCH_20_DAY"],"googleSearchStatus":"NOT_CONFIGURED","tavilyStatus":"CONFIGURED","status":"CONFIGURED"},"geminiAi":{"provider":"GeminiProvider","dailyCap":48,"status":"CONFIGURED"},"googleIndexing":{"client":"GoogleIndexingClient","auth":"RS256_JWT_OAUTH2_ASSERTION","dailyCap":180,"status":"CONFIGURED"},"brevoEmail":{"client":"BrevoMcpClient","atomicReservation":"PRE_SEND_D1_LEDGER","dailyCap":200,"status":"CONFIGURED"},"pageSpeedInsights":{"client":"GooglePageSpeedClient","dailyCap":40,"cacheTtl":"24H","status":"UNCONFIGURED_KEYLESS_MODE"},"razorpayPayments":{"client":"RazorpayAdapter","status":"CONFIGURED"},"cuelinksAffiliate":{"client":"CuelinksV3Client","status":"CHANNEL_APPROVED_NO_AFFILIATED_LINKS"},"monetizationEngines":{"engineA_selfServeTools":"ACTIVE","engineB_multiSectorAffiliate":"ACTIVE","engineC_tenantAutomation":"ACTIVE","engineD_partnerDistribution":"ACTIVE"}}}
```

### Command: curl.exe -sS -i --max-time 15 "https://ai-marketing-organization.onrender.com/api/v1/public/revenue-funnel"
UTC Timestamp: 2026-11-08T06:45:48.933Z
```
HTTP/1.1 200 OK
Date: Sun, 08 Nov 2026 06:45:58 GMT
Content-Type: application/json
Transfer-Encoding: chunked
Connection: keep-alive
access-control-allow-credentials: true
access-control-expose-headers: Set-Cookie
cf-cache-status: DYNAMIC
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://checkout.razorpay.com https://*.razorpay.com; frame-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com; child-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://*.razorpay.com; connect-src 'self' https://api.razorpay.com https://checkout.razorpay.com https://lumberjack.razorpay.com https://*.razorpay.com; img-src 'self' data: https: https://*.razorpay.com; style-src 'self' 'unsafe-inline' https:; font-src 'self' data: https:; frame-ancestors 'self'
cross-origin-embedder-policy: unsafe-none
referrer-policy: strict-origin-when-cross-origin
rndr-id: 098a4d1c-592a-4119
Server: cloudflare
strict-transport-security: max-age=31536000; includeSubDomains
vary: Origin
vary: Accept-Encoding
x-content-type-options: nosniff
x-render-origin-server: Render
CF-RAY: a5729df98a6b4934-BOM
alt-svc: h3=":443"; ma=86400

{"success":true,"data":{"measurementStatus":"VERIFIED_LIVE_DB","failedQueries":[],"funnel":{"verifiedExternalVisits":0,"internalTestSessions":0,"verifiedHumanOutboundClicks":0,"browserCandidateOutboundClicks":1,"internalDiagnosticClicks":4,"botClicks":0,"unknownClicks":2,"externalOutboundClicks":0,"clickThroughRate":"0.00%","conversions":0,"estimatedPendingCommissionINR":0,"approvedCommissionINR":0,"bankCashReceivedINR":0},"affiliateFunnel":{"verifiedExternalVisits":0,"internalTestSessions":0,"verifiedHumanOutboundClicks":0,"browserCandidateOutboundClicks":1,"internalDiagnosticClicks":4,"botClicks":0,"unknownClicks":2,"externalOutboundClicks":0,"clickThroughRate":"0.00%","conversions":0,"estimatedPendingCommissionINR":0,"approvedCommissionINR":0,"bankCashReceivedINR":0},"b2bFunnel":{"prospectsResearched":1213,"inquiriesReceived":0,"lifetimeDraftsPrepared":38,"pendingUnapprovedDrafts":38,"outreachDraftsPrepared":38,"ownerApprovedDrafts":0,"messagesDispatched":0,"providerConfirmedDeliveries":0,"proposalsSent":0,"proposalsAccepted":0,"verifiedClientPaymentsINR":0},"selfServeSaaSFunnel":{"siteAuditsStarted":2,"siteAuditsCompleted":2,"htmlScanCompleted":2,"pageSpeedCompleted":0,"siteAuditsFailed":0,"fixPackPreviews":0,"checkoutInitiated":0,"paymentOrdersCreated":0,"paymentAuthorized":0,"paymentCaptured":0,"fulfilmentsPending":0,"fulfilmentsCompleted":0,"fulfilmentsFailed":0,"refunds":0,"grossCapturedINR":0,"refundAmountINR":0,"netCapturedINR":0,"settledINR":0,"bankConfirmedCashINR":0,"commercialAttestationStatus":"READY","checkoutStatus":"READY","missingConfiguration":[]},"operatingCosts":{"hostingCostINR":0,"databaseCostINR":0,"aiModelCostINR":0,"paidToolCostINR":0,"totalOperatingCostINR":0,"unmeasuredExternalCosts":"FREE_TIER_QUOTA_BOUNDED","costClassification":"STRICT_ZERO_CASH_OUTFLOW","costBreakdown":[{"category":"Hosting","provider":"Render","tier":"FREE_TIER","monthlyQuota":"750 hours/month","costINR":0,"classification":"FREE_TIER"},{"category":"Database","provider":"Cloudflare D1","tier":"FREE_TIER","monthlyQuota":"5M reads / 100k writes per day","costINR":0,"classification":"FREE_TIER"},{"category":"AI Inference","provider":"Google Gemini","tier":"FREE_TIER","monthlyQuota":"15 RPM / 1M TPM / 1500 RPD","costINR":0,"classification":"FREE_TIER"},{"category":"Market Intelligence","provider":"Tavily Search","tier":"FREE_TIER","monthlyQuota":"1,000 queries/month","costINR":0,"classification":"FREE_TIER"},{"category":"Automation Engine","provider":"Cloudflare Workers Cron","tier":"FREE_TIER","monthlyQuota":"100,000 requests/day","costINR":0,"classification":"FREE_TIER"},{"category":"Software Licenses","provider":"Client-Owned WhatsApp & Google Sheets","tier":"BYO_CLIENT","monthlyQuota":"Unlimited client-owned","costINR":0,"classification":"BYO_CLIENT"},{"category":"Owner Operations & Engineering Labor","provider":"In-House Owner","tier":"OWNER_LABOR","monthlyQuota":"Excluded","costINR":0,"classification":"LABOR_EXCLUDED"}]},"profitability":{"grossRevenueCollectedINR":0,"totalOperatingCostINR":0,"netOperatingContributionINR":0,"bankCashReceivedINR":0,"laborExclusionNote":"Owner engineering and commercial operations labor is excluded from cash operating costs."},"provider":{"configured":true,"channelId":331585,"channelStatus":"APPROVED","reportedClicks":11,"reportedTransactions":0,"pendingCommissionINR":0,"approvedCommissionINR":0,"paidPayoutINR":0,"reportingLatency":"48-72h (Offline Tracking Mode)","validationCycle":"45-60 days"},"monetizedPartners":[{"name":"Akasa Air","campaignId":57507,"model":"CPS (Cost Per Sale)","payoutINR":"₹225.00 per domestic booking","cookieWindow":"30 Days","trackingUrl":"https://clnk.in/DKX3","trackingMode":"Offline (48h delay)"},{"name":"Air India Express","campaignId":5195,"model":"CPS (Cost Per Sale)","payoutINR":"₹101.25 domestic / ₹168.75 international","cookieWindow":"30 Days","trackingUrl":"https://clnk.in/DKRM","trackingMode":"Offline (48h delay)"},{"name":"Air India","campaignId":5622,"model":"CPS (Cost Per Sale)","payoutINR":"₹112.50 domestic / ₹375.00 international","cookieWindow":"30 Days","trackingUrl":"https://clnk.in/DKX4","trackingMode":"Offline (48h delay)"},{"name":"Cleartrip Flight","campaignId":29,"model":"CPS (Cost Per Sale)","payoutINR":"₹67.50 per flight booking","cookieWindow":"1 Day","trackingUrl":"https://clnk.in/DKRN","trackingMode":"Offline (48h delay)"}],"accountingPolicies":{"cashRecognitionRule":"Cash is strictly ₹0.00 until confirmed by bank settlement credits.","offlineAttributionNotice":"Airline booking conversions are tracked offline by affiliate networks and report with a 48–72 hour delay.","validationPeriod":"Airlines validate passenger travel completion within 45–60 days before releasing commissions."},"lastUpdated":"2026-11-08T06:45:58.034Z"}}
```

