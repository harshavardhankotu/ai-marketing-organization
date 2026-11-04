/**
 * SiteFix AI: Public Interactive Tool UI (/tools/site-audit)
 * Implements V6.2 Specification Phase 4:
 * - Eliminates DOM XSS via strict HTML escaping.
 * - Integrates real Razorpay checkout and /verify-payment loop when attested & configured.
 * - Displays truthful fail-closed status when checkout is locked.
 */

export function renderSiteAuditPage(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SiteFix AI — Instant Website Audit & Optimization Pack</title>
  <meta name="description" content="Free factual technical website audit. Detect HTML metadata gaps, Schema.org syntax errors, search accessibility blockers, and get copy-paste fixes.">
  <link rel="canonical" href="https://ai-marketing-organization.onrender.com/tools/site-audit">
  <meta property="og:title" content="SiteFix AI — Instant Website Audit & Optimization Pack">
  <meta property="og:description" content="Free factual technical website audit. Detect HTML metadata gaps, Schema.org syntax errors, search accessibility blockers, and get copy-paste fixes.">
  <meta property="og:type" content="website">
  <meta name="twitter:card" content="summary_large_image">
  <script src="https://checkout.razorpay.com/v1/checkout.js"></script>
  <style>
    :root {
      --bg: #090d16;
      --card-bg: #111827;
      --card-border: #1f2937;
      --text-main: #f9fafb;
      --text-muted: #9ca3af;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --font: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background-color: var(--bg);
      color: var(--text-main);
      font-family: var(--font);
      line-height: 1.6;
      padding: 0 1rem 4rem 1rem;
    }
    header {
      max-width: 900px;
      margin: 2rem auto;
      text-align: center;
    }
    .badge {
      display: inline-block;
      padding: 0.25rem 0.75rem;
      border-radius: 9999px;
      font-size: 0.8rem;
      font-weight: 600;
      background: rgba(59, 130, 246, 0.2);
      color: #60a5fa;
      margin-bottom: 1rem;
      border: 1px solid rgba(59, 130, 246, 0.4);
    }
    h1 {
      font-size: 2.25rem;
      font-weight: 800;
      letter-spacing: -0.025em;
      margin-bottom: 0.75rem;
      background: linear-gradient(to right, #60a5fa, #a78bfa);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }
    p.subtitle {
      color: var(--text-muted);
      font-size: 1.1rem;
      max-width: 650px;
      margin: 0 auto 1.5rem auto;
    }
    .container {
      max-width: 900px;
      margin: 0 auto;
    }
    .card {
      background: var(--card-bg);
      border: 1px solid var(--card-border);
      border-radius: 12px;
      padding: 2rem;
      margin-bottom: 2rem;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5);
    }
    .form-group {
      margin-bottom: 1.25rem;
    }
    label {
      display: block;
      margin-bottom: 0.5rem;
      font-weight: 600;
      font-size: 0.95rem;
    }
    input[type="url"], input[type="email"], select {
      width: 100%;
      padding: 0.75rem 1rem;
      background: #0d131f;
      border: 1px solid var(--card-border);
      border-radius: 8px;
      color: #fff;
      font-size: 1rem;
      outline: none;
      transition: border-color 0.2s;
    }
    input[type="url"]:focus, input[type="email"]:focus, select:focus {
      border-color: var(--primary);
    }
    .checkbox-group {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
      margin: 1.25rem 0;
      font-size: 0.9rem;
      color: var(--text-muted);
    }
    .checkbox-group input {
      margin-top: 0.25rem;
      cursor: pointer;
    }
    button.btn-primary {
      width: 100%;
      background: var(--primary);
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 0.875rem;
      font-size: 1.05rem;
      font-weight: 700;
      cursor: pointer;
      transition: background-color 0.2s, transform 0.1s;
    }
    button.btn-primary:hover {
      background: var(--primary-hover);
    }
    button.btn-primary:disabled {
      background: #374151;
      cursor: not-allowed;
    }
    .disclaimer-box {
      background: rgba(31, 41, 55, 0.5);
      border-left: 4px solid #6b7280;
      padding: 0.75rem 1rem;
      font-size: 0.85rem;
      color: #9ca3af;
      margin-top: 1rem;
      border-radius: 0 6px 6px 0;
    }
    .results-area {
      display: none;
    }
    .score-banner {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 1.5rem;
      border-bottom: 1px solid var(--card-border);
      margin-bottom: 1.5rem;
      gap: 1rem;
    }
    .score-circle {
      width: 72px;
      height: 72px;
      border-radius: 50%;
      background: #1f2937;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.6rem;
      font-weight: 800;
      border: 3px solid var(--primary);
      flex-shrink: 0;
    }
    .finding-item {
      padding: 1rem;
      border-radius: 8px;
      background: #0d131f;
      margin-bottom: 0.75rem;
      border-left: 4px solid #4b5563;
    }
    .finding-item.ISSUE { border-left-color: var(--danger); }
    .finding-item.WARNING { border-left-color: var(--warning); }
    .finding-item.PASS { border-left-color: var(--success); }
    .finding-header {
      display: flex;
      justify-content: space-between;
      font-weight: 600;
      margin-bottom: 0.25rem;
    }
    .checkout-box {
      margin-top: 2rem;
      padding: 1.5rem;
      background: #0d131f;
      border-radius: 8px;
      border: 1px solid var(--card-border);
    }
    .download-success-box {
      display: none;
      margin-top: 1.5rem;
      padding: 1.5rem;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid var(--success);
      border-radius: 8px;
      text-align: center;
    }
  </style>
</head>
<body>
  <header>
    <div class="badge">SiteFix AI • Factual Technical Website Audit & Fixes</div>
    <h1>Instant Website Audit & Optimization Pack</h1>
    <p class="subtitle">
      Zero fake scores. Inspect your live website for technical metadata gaps, Schema.org syntax errors,
      and search engine accessibility blockers with strict OWASP SSRF protection.
    </p>
  </header>

  <div class="container">
    <div class="card" id="scan-form-card">
      <form id="auditForm" onsubmit="handleAudit(event)">
        <div class="form-group">
          <label for="targetUrl">Public Website URL (HTTPS)</label>
          <input type="url" id="targetUrl" placeholder="https://example.com" required>
        </div>

        <div class="form-group">
          <label for="websiteType">Website Category (Optional)</label>
          <select id="websiteType">
            <option value="LOCAL_BUSINESS">Local Business / Clinic / Service Provider</option>
            <option value="SHOPIFY_ECOMMERCE">Shopify / Ecommerce Store</option>
            <option value="FREELANCER_PORTFOLIO">Freelancer / Portfolio / Agency</option>
            <option value="SAAS">SaaS / Web App</option>
            <option value="GENERAL_CONTENT">General Blog / Content Website</option>
          </select>
        </div>

        <div class="checkbox-group">
          <input type="checkbox" id="ownershipConsent" required>
          <label for="ownershipConsent">
            I confirm that I own or am authorized to audit this public website destination.
          </label>
        </div>

        <button type="submit" class="btn-primary" id="scanBtn">
          Start Technical Website Scan
        </button>

        <div class="disclaimer-box">
          <strong>Non-intrusive Diagnostic:</strong> We inspect public HTML headers, meta tags, and structured data with a strict 5s timeout.
          We never crawl internal subpages, submit forms, or run invasive security exploits.
          No Core Web Vitals or search ranking guarantees are claimed.
        </div>
      </form>
    </div>

    <!-- Results Area -->
    <div class="card results-area" id="resultsCard">
      <div class="score-banner">
        <div>
          <h2 id="resultStatus">Audit Completed</h2>
          <p id="resultExplanation" style="color: var(--text-muted); font-size: 0.9rem; max-width: 600px; margin-top: 0.25rem;"></p>
        </div>
        <div class="score-circle" id="scoreDisplay">--</div>
      </div>

      <h3 style="margin-bottom: 1rem;">Diagnostic Findings</h3>
      <div id="findingsContainer"></div>

      <!-- Commercial Fix-Pack Area -->
      <div class="checkout-box">
        <h3>Downloadable Optimization Pack (Fix-Pack)</h3>
        <p style="color: var(--text-muted); font-size: 0.95rem; margin: 0.5rem 0 1rem 0;">
          Get ready-to-use HTML &lt;head&gt; tags, valid Schema.org JSON-LD structured data,
          and a step-by-step implementation checklist for WordPress, Shopify, or custom HTML.
        </p>

        <!-- Dynamic Checkout Container -->
        <div id="checkoutActionContainer">
          <div id="checkoutGateNotice" style="background: rgba(245, 158, 11, 0.1); border: 1px solid var(--warning); padding: 1rem; border-radius: 6px; margin-bottom: 1rem;">
            <strong style="color: var(--warning);">Self-Serve Checkout Status:</strong>
            <span id="checkoutStatusText" style="font-size: 0.9rem; color: #d1d5db; display: block; margin-top: 0.25rem;">
              Checking payment gateway availability...
            </span>
          </div>

          <!-- Razorpay Sandbox Test Mode Notice & Mock Credentials -->
          <div style="background: rgba(30, 58, 138, 0.25); border: 1px solid rgba(59, 130, 246, 0.4); border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1rem; text-align: left;">
            <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.4rem;">
              <strong style="color: #93c5fd; font-size: 0.88rem;">🧪 Razorpay Sandbox / Test Mode Active</strong>
              <span style="font-size: 0.72rem; background: rgba(59, 130, 246, 0.25); color: #bfdbfe; padding: 2px 8px; border-radius: 4px; font-weight: 700;">SANDBOX ONLY</span>
            </div>
            <p style="font-size: 0.82rem; color: #d1d5db; margin: 0 0 0.65rem 0;">
              Checkout operates in <strong>Test Mode</strong>. The Razorpay modal opens in sandbox mode—no real currency is moved. Use standard mock details:
            </p>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem; font-size: 0.82rem; font-family: monospace;">
              <div style="background: rgba(0,0,0,0.35); padding: 0.6rem 0.75rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08);">
                <span style="color: #9ca3af; display: block; font-family: sans-serif; font-size: 0.75rem;">Mock Card (Any 6-digit OTP)</span>
                <strong style="color: #60a5fa; font-size: 0.9rem;">4100 2800 0000 10007</strong>
                <span style="color: #9ca3af; display: block; font-size: 0.75rem; margin-top: 2px;">Exp: 12/26 • CVV: 123</span>
              </div>
              <div style="background: rgba(0,0,0,0.35); padding: 0.6rem 0.75rem; border-radius: 6px; border: 1px solid rgba(255,255,255,0.08);">
                <span style="color: #9ca3af; display: block; font-family: sans-serif; font-size: 0.75rem;">Mock UPI ID (Auto-Approve)</span>
                <strong style="color: #34d399; font-size: 0.9rem;">test@razorpay</strong>
                <span style="color: #9ca3af; display: block; font-size: 0.75rem; margin-top: 2px;">Instant simulated capture</span>
              </div>
            </div>
          </div>

          <button class="btn-primary" id="checkoutBtn" onclick="initiateCheckout(49900)" disabled>
            Unlock & Download Complete Fix-Pack (₹499 Sandbox Mode)
          </button>
          <button class="btn-primary" id="testPayOneRupeeBtn" onclick="initiateCheckout(100)" style="margin-top: 0.75rem; background: #10b981; border: 1px solid #059669; display: flex; align-items: center; justify-content: center; gap: 0.5rem; width: 100%;" disabled>
            <span>⚡ Launch Razorpay Sandbox Modal (₹1.00 Test Mode)</span>
          </button>
        </div>

        <!-- Download Success Box -->
        <div class="download-success-box" id="downloadSuccessBox">
          <h4 style="color: var(--success); margin-bottom: 0.5rem;">Payment Verified Successfully!</h4>
          <p style="font-size: 0.9rem; color: #d1d5db; margin-bottom: 1rem;">
            Your 72-hour entitlement token has been issued. Click below to download your complete Optimization Fix-Pack.
          </p>
          <a id="downloadLink" href="#" class="btn-primary" style="display: inline-block; text-decoration: none; max-width: 300px; padding: 0.75rem 1.5rem;" target="_blank">
            Download Fix-Pack (JSON / Markdown)
          </a>
        </div>
      </div>
    </div>
  </div>

  <script>
    let currentAuditId = null;
    let currentReadiness = null;

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    async function checkReadiness() {
      try {
        const res = await fetch('/api/v1/tools/site-audit/readiness');
        const data = await res.json();
        currentReadiness = data;
        updateCheckoutUI();
      } catch (e) {
        currentReadiness = { status: 'LOCKED_MISSING_CONFIGURATION', isReady: false };
        updateCheckoutUI();
      }
    }

    function updateCheckoutUI() {
      const notice = document.getElementById('checkoutGateNotice');
      const text = document.getElementById('checkoutStatusText');
      const btn = document.getElementById('checkoutBtn');
      const testBtn = document.getElementById('testPayOneRupeeBtn');

      if (!currentReadiness || !currentReadiness.isReady) {
        btn.disabled = true;
        btn.innerText = 'Checkout Locked (Pending Gateway Setup)';
        if (testBtn) testBtn.disabled = true;
        notice.style.borderColor = 'var(--warning)';
        text.innerText = 'Free technical diagnostic scan is active. Live ₹499 digital checkout is currently locked pending owner Razorpay gateway credentials and terms attestation.';
      } else {
        btn.disabled = false;
        btn.innerText = 'Unlock & Download Complete Fix-Pack (₹499 Sandbox Mode)';
        if (testBtn) testBtn.disabled = false;
        notice.style.borderColor = 'var(--success)';
        notice.style.background = 'rgba(16, 185, 129, 0.1)';
        text.innerHTML = '<strong style="color: var(--success);">Ready (Test Sandbox Mode):</strong> Razorpay Sandbox gateway connected. Use mock card or UPI to simulate transaction (Zero real currency moved).';
      }
    }

    // Check readiness on page load
    checkReadiness();

    async function handleAudit(e) {
      e.preventDefault();
      const url = document.getElementById('targetUrl').value;
      const websiteType = document.getElementById('websiteType').value;
      const btn = document.getElementById('scanBtn');

      btn.disabled = true;
      btn.innerText = 'Scanning Website (OWASP SSRF Protected)...';

      try {
        const res = await fetch('/api/v1/tools/site-audit/scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url,
            websiteType,
            userConfirmedOwnership: true
          })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          alert('Scan failed: ' + (data.error || 'Server error'));
          return;
        }

        currentAuditId = data.result.auditId;
        renderResults(data.result);
      } catch (err) {
        alert('Scan error: ' + err.message);
      } finally {
        btn.disabled = false;
        btn.innerText = 'Start Technical Website Scan';
      }
    }

    function renderResults(result) {
      document.getElementById('resultsCard').style.display = 'block';
      document.getElementById('scoreDisplay').textContent = String(result.score);
      document.getElementById('resultStatus').textContent = 'Audit Status: ' + result.overallStatus;
      document.getElementById('resultExplanation').textContent = result.scoreExplanation;

      const container = document.getElementById('findingsContainer');
      container.innerHTML = '';

      result.findings.forEach(f => {
        const div = document.createElement('div');
        div.className = 'finding-item ' + (f.status === 'PASS' || f.status === 'WARNING' || f.status === 'ISSUE' ? f.status : 'INFO');

        const header = document.createElement('div');
        header.className = 'finding-header';

        const titleSpan = document.createElement('span');
        titleSpan.textContent = '[' + f.category + '] ' + f.title;

        const badgeSpan = document.createElement('span');
        badgeSpan.style.fontSize = '0.8rem';
        badgeSpan.textContent = f.status + ' (' + f.severity + ')';

        header.appendChild(titleSpan);
        header.appendChild(badgeSpan);
        div.appendChild(header);

        if (f.evidence) {
          const evidenceDiv = document.createElement('div');
          evidenceDiv.style.fontSize = '0.85rem';
          evidenceDiv.style.color = '#9ca3af';
          evidenceDiv.style.marginBottom = '0.25rem';
          evidenceDiv.textContent = f.evidence;
          div.appendChild(evidenceDiv);
        }

        const recDiv = document.createElement('div');
        recDiv.style.fontSize = '0.9rem';
        recDiv.style.marginTop = '0.25rem';
        recDiv.innerHTML = '<strong>Action:</strong> ' + escapeHtml(f.recommendation);
        div.appendChild(recDiv);

        container.appendChild(div);
      });

      document.getElementById('resultsCard').scrollIntoView({ behavior: 'smooth' });
    }

    async function initiateCheckout(targetPaise) {
      if (!currentAuditId) {
        alert('Please run a website audit scan first.');
        return;
      }

      const isTest = targetPaise === 100;
      const btn = isTest ? document.getElementById('testPayOneRupeeBtn') : document.getElementById('checkoutBtn');
      if (btn) {
        btn.disabled = true;
        btn.innerText = 'Creating Payment Order...';
      }

      try {
        const res = await fetch('/api/v1/tools/site-audit/' + currentAuditId + '/checkout', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            customerEmail: 'customer@example.com',
            amountPaise: isTest ? 100 : 49900,
            amountINR: isTest ? 1 : 499,
            isTestPayment: isTest
          })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
          alert('Checkout unavailable: ' + (data.error || 'Server error'));
          if (btn) {
            btn.disabled = false;
            btn.innerText = isTest ? '⚡ Launch Razorpay Sandbox Modal (₹1.00 Test Mode)' : 'Unlock & Download Complete Fix-Pack (₹499 Sandbox Mode)';
          }
          return;
        }

        if (!data.keyId) {
          throw new Error('Payment gateway keyId is missing from server checkout response.');
        }

        const options = {
          key: data.keyId,
          amount: data.amount,
          currency: data.currency,
          name: 'SiteFix AI (Test Sandbox)',
          description: isTest
            ? 'Sandbox Mode — Simulated Test Payment (No Real Currency Moved)'
            : 'Website Optimization Fix-Pack (Test Sandbox)',
          notes: {
            mode: 'test',
            sandbox: 'true',
            mock_card: '4100 2800 0000 10007',
            mock_upi: 'test@razorpay'
          },
          handler: async function (response) {
            if (btn) btn.innerText = 'Verifying Payment Capture...';
            try {
              const verifyRes = await fetch('/api/v1/tools/site-audit/' + currentAuditId + '/verify-payment', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(response)
              });
              const verifyData = await verifyRes.json();
              if (verifyData.success && verifyData.downloadUrl) {
                showDownloadSuccess(verifyData.downloadUrl);
              } else {
                alert('Payment received but verification pending. Please poll: ' + (verifyData.error || 'Unknown error'));
              }
            } catch (vErr) {
              alert('Payment verification request failed: ' + vErr.message);
            }
          },
          prefill: {
            name: 'Test Customer',
            email: 'test@example.com',
            contact: '9999999999'
          },
          theme: {
            color: isTest ? '#10b981' : '#3b82f6'
          }
        };

        if (data.createdViaRazorpayApi === true || (data.order && data.order.createdViaRazorpayApi === true)) {
          options.order_id = data.orderId;
        }

        if (!options.order_id) {
          throw new Error('A genuine server-generated Razorpay order_id is required to launch Checkout.');
        }

        const rzp = new Razorpay(options);
        rzp.on('payment.failed', function (resp) {
          alert('Payment Failed: ' + (resp.error?.description || 'Unknown error'));
          if (btn) {
            btn.disabled = false;
            btn.innerText = isTest ? '⚡ Launch Razorpay Sandbox Modal (₹1.00 Test Mode)' : 'Unlock & Download Complete Fix-Pack (₹499 Sandbox Mode)';
          }
        });
        rzp.open();
      } catch (err) {
        alert('Checkout error: ' + err.message);
        if (btn) {
          btn.disabled = false;
          btn.innerText = isTest ? '⚡ Launch Razorpay Sandbox Modal (₹1.00 Test Mode)' : 'Unlock & Download Complete Fix-Pack (₹499 Sandbox Mode)';
        }
      }
    }

    function showDownloadSuccess(downloadUrl) {
      document.getElementById('checkoutActionContainer').style.display = 'none';
      const box = document.getElementById('downloadSuccessBox');
      box.style.display = 'block';
      const link = document.getElementById('downloadLink');
      link.href = downloadUrl;
    }
  </script>
</body>
</html>`;
}
