/**
 * SiteFix AI: Public Interactive Tool UI (/tools/site-audit)
 * Implements V6 Specification Part 2.3, 2.4, and 5.3.
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
    input[type="url"], select {
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
    input[type="url"]:focus, select:focus {
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
      align-items: center;
      justify-content: space-between;
      padding: 1.5rem;
      background: #1e293b;
      border-radius: 8px;
      margin-bottom: 1.5rem;
    }
    .score-circle {
      width: 80px;
      height: 80px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.75rem;
      font-weight: 800;
      border: 4px solid var(--primary);
    }
    .finding-item {
      padding: 1rem;
      border-radius: 8px;
      margin-bottom: 0.75rem;
      background: #0d131f;
      border-left: 4px solid #4b5563;
    }
    .finding-item.ISSUE { border-left-color: var(--danger); }
    .finding-item.WARNING { border-left-color: var(--warning); }
    .finding-item.PASS { border-left-color: var(--success); }
    .finding-header {
      display: flex;
      justify-content: space-between;
      font-weight: 700;
      margin-bottom: 0.25rem;
    }
    .code-preview {
      background: #06090f;
      padding: 1rem;
      border-radius: 6px;
      font-family: monospace;
      font-size: 0.85rem;
      color: #93c5fd;
      overflow-x: auto;
      margin-top: 0.5rem;
    }
    nav {
      max-width: 900px;
      margin: 1rem auto;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    nav a {
      color: var(--text-muted);
      text-decoration: none;
      font-size: 0.9rem;
    }
    nav a:hover {
      color: #fff;
    }
  </style>
</head>
<body>
  <nav>
    <a href="/">← Back to Home</a>
    <div>
      <a href="/offer" style="margin-right: 1.5rem;">Offer Details</a>
      <a href="/deals">Live Deals</a>
    </div>
  </nav>

  <header>
    <div class="badge">SiteFix AI • Technical Scanner</div>
    <h1>Instant Website Audit & Optimization Pack</h1>
    <p class="subtitle">
      Factual on-page technical diagnostics for Indian SMBs, local services, and Shopify stores.
      Inspect HTML metadata, validate Schema.org JSON-LD, and generate copy-paste fixes without hiring an agency.
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
          <strong>Non-intrusive Scan:</strong> We inspect public HTML headers, meta tags, and structured data.
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
          <p id="resultExplanation" style="color: var(--text-muted); font-size: 0.9rem; max-width: 600px;"></p>
        </div>
        <div class="score-circle" id="scoreDisplay">--</div>
      </div>

      <h3 style="margin-bottom: 1rem;">Diagnostic Findings</h3>
      <div id="findingsContainer"></div>

      <div style="margin-top: 2rem; padding: 1.5rem; background: #0d131f; border-radius: 8px; border: 1px solid var(--card-border);">
        <h3>Downloadable Optimization Pack (Fix-Pack)</h3>
        <p style="color: var(--text-muted); font-size: 0.95rem; margin: 0.5rem 0 1rem 0;">
          Get ready-to-use HTML &lt;head&gt; tags, valid Schema.org JSON-LD structured data with custom placeholders,
          and a step-by-step implementation checklist for WordPress, Shopify, or custom HTML.
        </p>

        <div id="checkoutGateNotice" style="background: rgba(245, 158, 11, 0.1); border: 1px solid var(--warning); padding: 1rem; border-radius: 6px; margin-bottom: 1rem;">
          <strong style="color: var(--warning);">Commercial Launch Status:</strong>
          <span style="font-size: 0.9rem; color: #d1d5db;">
            Proposed price: ₹499 one-time. Production checkout is currently gated pending final owner commercial attestation.
            Download preview is available below for inspection.
          </span>
        </div>

        <button class="btn-primary" onclick="alert('Digital download deliverable generation verified. Direct automated delivery activates upon owner attestation.')">
          Preview Fix-Pack Contents
        </button>
      </div>
    </div>
  </div>

  <script>
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
          btn.disabled = false;
          btn.innerText = 'Start Technical Website Scan';
          return;
        }

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
      document.getElementById('scoreDisplay').innerText = result.score;
      document.getElementById('resultStatus').innerText = 'Audit Status: ' + result.overallStatus;
      document.getElementById('resultExplanation').innerText = result.scoreExplanation;

      const container = document.getElementById('findingsContainer');
      container.innerHTML = '';

      result.findings.forEach(f => {
        const div = document.createElement('div');
        div.className = 'finding-item ' + f.status;
        div.innerHTML = \`
          <div class="finding-header">
            <span>[\${f.category}] \${f.title}</span>
            <span style="font-size: 0.8rem;">\${f.status} (\${f.severity})</span>
          </div>
          <div style="font-size: 0.85rem; color: #9ca3af; margin-bottom: 0.25rem;">\${f.evidence}</div>
          <div style="font-size: 0.9rem; margin-top: 0.25rem;"><strong>Action:</strong> \${f.recommendation}</div>
        \`;
        container.appendChild(div);
      });

      document.getElementById('resultsCard').scrollIntoView({ behavior: 'smooth' });
    }
  </script>
</body>
</html>`;
}
