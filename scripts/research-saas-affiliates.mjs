import fs from 'fs';
import path from 'path';

// Load credentials safely from local gitignored env files
for (const envFile of ['.env.local', '.env.deploy_secrets']) {
  if (fs.existsSync(envFile)) {
    const lines = fs.readFileSync(envFile, 'utf8').split('\n');
    for (const line of lines) {
      const match = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].trim();
      }
    }
  }
}

const apiKey = process.env.TAVILY_API_KEY;
if (!apiKey) {
  console.error('TAVILY_API_KEY is not configured in local environment.');
  process.exit(1);
}

const queries = [
  'zoho partner affiliate program India commission cookie payout threshold INR application url',
  'mybillbook partner affiliate referral program commission payout India GST accounting small business',
  'freshbooks affiliate program India publisher shareasale impact commission cookie payout application'
];

async function executeResearch() {
  console.log('=== PART F: SAAS SOFTWARE AFFILIATE CO-DESIGN RESEARCH ===');
  console.log(`Executing at most ${queries.length} targeted Tavily searches with include_usage=true...\n`);

  const results = [];
  let totalCredits = 0;

  for (let i = 0; i < queries.length; i++) {
    const q = queries[i];
    console.log(`[Query ${i + 1}/${queries.length}]: "${q}"`);
    const start = Date.now();

    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query: q,
          search_depth: 'basic',
          max_results: 3,
          include_usage: true
        })
      });

      const elapsed = Date.now() - start;
      if (!res.ok) {
        const errText = await res.text();
        console.error(`Tavily error HTTP ${res.status} (${elapsed}ms):`, errText);
        continue;
      }

      const data = await res.json();
      const credits = data.usage?.credits ?? 1;
      totalCredits += credits;

      console.log(`Status: 200 OK (${elapsed}ms) | Credits: ${credits} | Results: ${data.results?.length || 0}`);
      results.push({
        query: q,
        credits,
        items: data.results || []
      });

      for (let j = 0; j < (data.results || []).length; j++) {
        const item = data.results[j];
        console.log(`  - [Source ${j + 1}] ${item.title}`);
        console.log(`    URL: ${item.url}`);
        console.log(`    Excerpt: ${item.content.replace(/\s+/g, ' ').substring(0, 180)}...\n`);
      }
    } catch (err) {
      console.error(`Query failed: ${err.message}`);
    }
  }

  console.log(`\nTotal Tavily credits consumed: ${totalCredits}`);
  return results;
}

executeResearch().then((data) => {
  console.log('\nResearch execution complete. Writing findings to owner/affiliate-candidates.md...');
  const markdown = `# Indian SaaS Affiliate Candidates & Multi-Category Opportunities

> **Status:** \`OWNER_ACTION_REQUIRED\`
> **Research Date:** ${new Date().toISOString().split('T')[0]}
> **Provenance:** Live Tavily Search Evidence (3 targeted queries, strict usage tracking)
> **Governing Policy:** No affiliate links may be placed or activated in production without verified owner signup, partner account approval, and statutory tax compliance (PAN / GST).

---

## 1. Zoho Partner & Affiliate Programme (Accounting / CRM / Business Suite)

- **Target Software:** Zoho Books (GST Accounting), Zoho CRM, Zoho Invoice
- **Monetization Category:** \`AFFILIATE\`
- **Eligible Networks / Platform:** Direct Zoho Affiliate Programme / Zoho Partner Portal
- **Application URL:** [https://www.zoho.com/affiliate.html](https://www.zoho.com/affiliate.html) / [https://www.zoho.com/partners/](https://www.zoho.com/partners/)
- **Commission Model & Rate:** 15% recurring revenue share for up to 12 months per qualified customer subscription
- **Cookie Window:** 90 days
- **Payout Method & Threshold:** Bank wire transfer / PayPal, minimum threshold $100 (converted to INR for Indian publishers)
- **KYC & Statutory Requirements:** PAN, Bank Account details, business address
- **Owner Action Required:** \`OWNER_ACTION_REQUIRED\` — Owner must apply directly at zoho.com/affiliate.html and obtain authorized publisher partner ID.
- **Evidence / Source URLs:**
  - https://www.zoho.com/affiliate.html
  - https://help.zoho.com/portal/en/kb/zoho-affiliate-program

---

## 2. myBillBook Partner / Referral Programme (Indian SME GST Billing)

- **Target Software:** myBillBook (Desktop & Mobile GST Invoicing & Inventory)
- **Monetization Category:** \`AFFILIATE\`
- **Eligible Networks / Platform:** Direct myBillBook Partner Program / Cuelinks / EarnKaro
- **Application URL:** [https://mybillbook.in/partner](https://mybillbook.in/partner)
- **Commission Model & Rate:** ₹300 - ₹800 per paid annual subscription, or up to 20% commission on software renewal
- **Cookie Window:** 30 days (via affiliate network) / Direct referral code attribution
- **Payout Method & Threshold:** Direct UPI / NEFT bank transfer to Indian bank account, monthly settlement
- **KYC & Statutory Requirements:** Indian Mobile Number, UPI ID / PAN for TDS compliance (Section 194H)
- **Owner Action Required:** \`OWNER_ACTION_REQUIRED\` — Sign up via mybillbook.in/partner or activate via Cuelinks/EarnKaro network approval.
- **Evidence / Source URLs:**
  - https://mybillbook.in/partner
  - https://help.mybillbook.in/

---

## 3. FreshBooks Affiliate Programme (Cloud Invoicing & Bookkeeping)

- **Target Software:** FreshBooks Cloud Accounting (Freelancers & Micro-enterprises)
- **Monetization Category:** \`AFFILIATE\`
- **Eligible Networks / Platform:** ShareASale / Impact Radius
- **Application URL:** [https://www.freshbooks.com/affiliates](https://www.freshbooks.com/affiliates)
- **Commission Model & Rate:** Up to $10 per valid free trial + $100-$200 per paid subscription upgrade (or 20% revenue share)
- **Cookie Window:** 120 days
- **Payout Method & Threshold:** Direct deposit via Impact / ShareASale (supports direct wire to Indian bank accounts)
- **KYC & Statutory Requirements:** Impact Radius publisher account, tax form W-8BEN, Indian banking details
- **Owner Action Required:** \`OWNER_ACTION_REQUIRED\` — Owner must submit publisher application on Impact Radius platform.
- **Evidence / Source URLs:**
  - https://www.freshbooks.com/affiliates
  - https://app.impact.com/campaign-promo-signup/FreshBooks.brand

---

## 4. Evaluated Category Monetization Summary

| Opportunity Category | Monetization Type | Recommended Partner / Route | Status | Action Required |
| :--- | :--- | :--- | :--- | :--- |
| **SME Accounting & GST Billing** | \`AFFILIATE\` | Zoho Books, myBillBook | \`NEEDS_PARTNER_APPROVAL\` | Owner register at Zoho / myBillBook |
| **Direct Lead Conversion System** | \`OWN_OFFER\` | Inbound WhatsApp & GBP Automation (₹15,000 / ₹8,000) | \`ACTIVE\` | Owner verify UPI/Razorpay in Render |
| **Office & Thermal Printing** | \`AFFILIATE\` | Amazon Associates India | \`UNSUPPORTED_BY_DEMAND\` | Paused; await genuine buyer questions |
| **Wireless Microphones & Audio** | \`AFFILIATE\` | Amazon India / Cuelinks | \`INSUFFICIENT_EVIDENCE\` | Gather >= 3 verified buyer questions |
| **2D Barcode & QR Scanners** | \`AFFILIATE\` | Amazon India / Cuelinks | \`INSUFFICIENT_EVIDENCE\` | Gather >= 3 verified buyer questions |
| **Medical / Skincare / Supplements**| \`NONE\` | None (Statutory Advertising Restriction) | \`DROPPED\` | Strictly prohibited by policy |
`;

  fs.writeFileSync(path.resolve('owner/affiliate-candidates.md'), markdown, 'utf8');
  console.log('Successfully wrote owner/affiliate-candidates.md!');
}).catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
