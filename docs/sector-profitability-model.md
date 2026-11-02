# Multi-Sector Profitability & Unit Economics Model (V4.2)

This model establishes the unit economics, conversion benchmarks, Earnings Per Click (EPC) baselines, break-even CPC ceilings, sample size thresholds, and contribution margin structures across the 8 authoritative commercial sectors of the AI Marketing Organization.

---

## 1. Operating Rules & Economic Invariants

1. **Paid Acquisition Spend Strictly ₹0.00:** The organization operates under a strict ₹0 ad budget policy until explicitly authorized by the owner. All break-even CPC calculations in this model represent theoretical ceilings for future evaluation and are not active bidding thresholds.
2. **Bank Statement Cash Invariant:** Cash revenue is recorded only upon verified credit to the business bank account. Unverified affiliate portal figures are logged as `PENDING` or `VERIFIED` commission receivable, never bank cash.
3. **Evidence Thresholds (No Small-Number Fallacies):**
   - Organic visitor conversion rates require at least **30 unique visitors** before computing a percentage. When $N < 30$, the system returns `INSUFFICIENT_EVIDENCE` or `UNKNOWN`.
   - Partner commission reconciliation requires transaction-level Sub-ID matching.
4. **Honest Empty States:** Sectors with zero verified active offers display an honest empty state with zero fabricated deals or mock discounts.

---

## 2. Sector-by-Sector Unit Economics Matrix

| Sector Code | Sector Name | Typical AOV (₹) | Commission Rate (%) | Gross Commission / Sale (₹) | Estimated Conv. Rate (%) | Estimated EPC (₹) | Theoretical Break-Even CPC (₹) | Min Visitor Sample Threshold | Statutory & Legal Restrictions |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **SECTOR_A** | **Gold, Silver, Bullion & Jewellery** | ₹15,000 – ₹45,000 | 1.5% – 5.0% | ₹350 – ₹1,800 | 0.8% – 2.0% | ₹3.50 – ₹25.00 | ₹3.50 | 30 visitors | Mandatory BIS Hallmark disclosure; zero commodity trading advice; fail-closed on benchmark rate outage. |
| **SECTOR_B** | **Electronics & Technology** | ₹3,500 – ₹18,000 | 2.0% – 6.0% | ₹90 – ₹750 | 1.5% – 3.5% | ₹2.00 – ₹18.00 | ₹2.00 | 30 visitors | Mandatory affiliate disclosure; accurate model specifications; no fake warranty claims. |
| **SECTOR_C** | **Home & Appliances** | ₹2,500 – ₹12,000 | 3.0% – 8.0% | ₹100 – ₹650 | 1.2% – 3.0% | ₹1.80 – ₹15.00 | ₹1.80 | 30 visitors | Energy star rating verification; manufacturer warranty disclosures. |
| **SECTOR_D** | **Travel & Experiences** | ₹6,000 – ₹30,000 | 1.5% – 4.5% | ₹120 – ₹900 | 0.5% – 1.8% | ₹1.00 – ₹12.00 | ₹1.00 | 30 visitors | Cancellation policy transparency; dynamic fare fluctuation notices. |
| **SECTOR_E** | **Software & Digital Services** | ₹1,500 – ₹8,000 / yr | 15.0% – 35.0% | ₹300 – ₹2,200 | 1.0% – 4.0% | ₹4.50 – ₹45.00 | ₹4.50 | 30 visitors | Transparent recurring billing disclosures; GDPR/DPDP privacy compliance. |
| **SECTOR_F** | **Office, Business & Industrial Equipment** | ₹4,500 – ₹25,000 | 4.0% – 10.0% | ₹200 – ₹1,800 | 1.0% – 2.5% | ₹2.50 – ₹30.00 | ₹2.50 | 30 visitors | GST invoice availability; commercial warranty specifications. |
| **SECTOR_G** | **Lifestyle & Consumer Goods** | ₹1,200 – ₹4,500 | 5.0% – 12.0% | ₹75 – ₹350 | 2.0% – 4.5% | ₹1.50 – ₹12.00 | ₹1.50 | 30 visitors | Sizing & return window disclosures; verified consumer reviews. |
| **SECTOR_H** | **Local Services & B2B Solutions** | ₹10,000 – ₹50,000 | Direct Retainer / 15% | ₹1,500 – ₹7,500 | 2.0% – 5.0% (Inquiry) | ₹15.00 – ₹150.00 | ₹15.00 | 20 inquiries | Strictly segregated; owner Click-to-Chat approval; no unsolicited messaging; medical advertising ethics. |

---

## 3. Mathematical Profitability Model

### 3.1 Expected Earnings Per Click (EPC)
For any sector $s$:
$$\text{EPC}_s = \text{CR}_s \times \text{AOV}_s \times \text{CommissionRate}_s$$
where:
- $\text{CR}_s$: Attributed buyer conversion rate from click to verified purchase.
- $\text{AOV}_s$: Average Order Value in INR.
- $\text{CommissionRate}_s$: Net affiliate or merchant commission percentage.

### 3.2 Net Contribution Margin (CM)
$$\text{Contribution Margin}_s = \text{Revenue}_s - \text{Variable Acquisition Cost}_s - \text{Platform Infrastructure Cost}_s$$
Under current zero-budget operation:
- $\text{Variable Acquisition Cost} = ₹0.00$
- $\text{Platform Infrastructure Cost} = \text{Fixed Hosting (Render Free / Standard)} + \text{D1 Operations (Zero marginal)}$
- $\text{Net Contribution Margin} \approx 98\% - 100\%$ on first rupee earned.

### 3.3 Paid Traffic CPC Break-Even Ceiling
Should the owner authorize paid acquisition in the future, the absolute maximum allowable CPC for any sector is bounded by:
$$\text{Max CPC}_s = \text{EPC}_s \times (1 - \text{Target Profit Margin})$$
With a required $40\%$ safety margin:
$$\text{Ceiling CPC}_s \le 0.60 \times \text{EPC}_s$$
Any paid campaign bidding above this ceiling is blocked by automated policy.

---

## 4. Sector Prioritization & Allocation Strategy

1. **Immediate Focus: Sector A (Precious Metals & Jewellery) + Sector B (Electronics)**
   - **Reason:** Sector A has the highest absolute rupee payout per transaction (₹350 – ₹1,800) due to high Indian wedding and festive demand. Sector B has the highest transaction frequency and deepest catalog in Cuelinks India.
2. **Secondary Organic Focus: Sector C (Home Appliances) + Sector F (Office & Thermal Printers)**
   - **Reason:** Strong B2B and consumer utility; high search intent for model comparisons and buying guides.
3. **Tertiary Focus: Sector E (Software & SaaS)**
   - **Reason:** Very high commission rates (15% – 35%), ideal for long-tail SEO articles.
4. **Strictly Segregated: Sector H (Local Services / Clinics)**
   - **Reason:** Operates under strict owner approval; medical compliance; zero outbound spam.
