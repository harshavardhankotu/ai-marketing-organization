# PILOT DELIVERY SPECIFICATION: FIRST PAID INDIAN SMB PILOT
=====================================================================

> **Target Audience:** Independent dental practices, healthcare clinics, and specialized local service businesses in India (Hyderabad, Guntur, Vijayawada, Bangalore, etc.).  
> **Operational Model:** Deliverable-first manual implementation using 100% free, owner-managed software tools.  
> **Zero Subscription Software Fees for Client:** No WhatsApp Cloud API fees, no Twilio bills, no third-party cloud hosting required.  
> **Commercial Status:** Pricing and commercial terms are `TBD / OWNER REVIEW REQUIRED`. The owner reviews, adjusts, and confirms all commercial terms before extending offers to prospects.

---

## 1. Target Customer Profile (Ideal Pilot Client)

- **Business Vertical:** Independent Dental Practice, Poly-Clinic, Diagnostic Center, or Physiotherapy Practice.
- **Geography:** Urban / semi-urban tier-1 or tier-2 Indian cities (e.g., Hyderabad, Guntur, Vijayawada, Bangalore).
- **Current Setup:**
  - Has a claimed Google Business Profile (GBP) with active patient reviews.
  - Receives patient reach-outs via phone calls, WhatsApp messages, and GBP profile visits.
  - Relies entirely on reception/front-desk staff during office hours (e.g., 9:30 AM – 8:00 PM).
  - Outside operating hours, incoming inquiries go unanswered until the next morning or Monday.
- **Pain Point:** Outside clinic operating hours, incoming patient inquiries go unanswered until staff returns the next morning. Response delay outside clinic hours is measured directly from reception logs during the Day 1 intake audit (OWNER_MEASURED: Day 1 reception call and WhatsApp message audit). Unanswered inquiries risk booking with nearby competitor clinics.

---

## 2. Deliverable Package & Delivery Modes

Every deliverable is executed with **100% free, client-controlled tools** or internal reporting software. Zero phantom features or discontinued services.

| Deliverable # | Name | Tool / Platform | Delivery Mode | Description |
|:---:|---|---|---|---|
| **D1** | **WhatsApp Business Triage Setup** | WhatsApp Business App (Free) | `MANUAL_BY_OWNER` | Configure business profile, operating hours, automated greeting message, and automated after-hours away message with emergency protocol. |
| **D2** | **Top 10 FAQ Quick Replies (`/faq`)** | WhatsApp Business App (Free) | `MANUAL_BY_OWNER` | Preset shortcuts for reception staff: `/fee`, `/hours`, `/location`, `/book`, `/services`, `/parking`, `/cancel`, `/insurance`, `/emergency`, `/followup`. |
| **D3** | **Color-Coded Pipeline Labels** | WhatsApp Business App (Free) | `MANUAL_BY_OWNER` | Standardized label taxonomy: `New Inquiry` (Blue), `Awaiting Reply` (Yellow), `Appointment Booked` (Orange), `Consultation Completed` (Green), `Follow-Up Needed` (Purple). |
| **D4** | **Private Inquiry & SLA Tracker** | Google Sheets (Free) | `MANUAL_BY_OWNER` | Shared response-time tracking sheet capturing inquiry timestamp, channel, staff response delay, and consultation outcome. |
| **D5** | **Google Business Profile Audit & WhatsApp CTA** | Google Business Profile | `MANUAL_BY_OWNER` | Audit profile NAP consistency, operating hours, primary categories, and add direct WhatsApp Click-to-Chat link (`https://wa.me/91...`). |
| **D6** | **Self-Service Calendar Booking Link** | Cal.com (Free) or Google Calendar | `MANUAL_BY_OWNER` | Direct booking link configured to doctor chair time to eliminate manual scheduling friction. |
| **D7** | **Weekly Show-Rate & Performance Report** | Manual Spreadsheet / Summary | `MANUAL_BY_OWNER` | Weekly summary of total inquiries, median response time, consultation conversion rate, and show-up rate compiled manually from the shared tracking sheet. |
| **D8** | **Inquiry Data Safety & Retention Guidelines (Draft)** | Policy Template / Guide | `DOCUMENTATION` | Operational data safety guidelines and template ensuring minimal contact logging, access removal at handover, and client-controlled retention. (Draft. Not legal advice. A lawyer must review it before use.) |

---

## 3. Strict Safety & Platform Boundaries (What is NEVER Promised)

1. **NO WhatsApp Cloud API Bot:**  
   The pilot uses the official, free **WhatsApp Business App** on the client's mobile phone or reception desktop. We do not provision or bill for third-party WhatsApp Cloud API, BSPs, or Twilio bots.
2. **NO Google Business Profile Automated Chat:**  
   *Official Google Policy Notice:* Google permanently shut down Google Business Profile chat on **July 31, 2024**. We strictly integrate a WhatsApp click-to-chat link in profile contact fields; we never promise automated chat inside Google Maps or Search.
3. **NO 2-Minute SLA Guarantee:**  
   Automated app greeting/away messages fire instantly upon receipt; however, human staff responses vary. We never guarantee sub-2-minute human medical responses or 100% lead conversion.
4. **NO Rupee Revenue Guarantees:**  
   Calculators and projections represent **theoretical mathematical estimates only**. We guarantee structured triage, response-delay reduction, and organized lead tracking — never promised patient cash or clinical fees.
5. **NO Unsolicited Outbound Messaging:**  
   All workflows are strictly **inbound-first**. We never perform cold outreach, unsolicited WhatsApp broadcasting, or scraping of private patient directories.

---

## 4. 30-Minute Kickoff Questionnaire (Intake Protocol)

During the onboarding kickoff with the clinic owner/doctor, gather these 8 operational parameters:

1. **Clinic Basics:** Full registered name, address, Google Maps link, and official WhatsApp Business mobile number.
2. **Operating Hours:** Weekday hours, Saturday hours, Sunday availability, and lunch breaks.
3. **Top 5 Inbound Inquiries:** The 5 most frequent patient questions (e.g. root canal cost, implant charges, teeth cleaning duration, dental braces consultation).
4. **Emergency Escalation:** Exact phone number and instructions for acute emergencies (e.g., severe toothache, trauma, post-extraction bleeding).
5. **Booking Rules:** Can patients self-schedule online, or does reception need to confirm practitioner chair time first?
6. **Consultation Fee & Payment:** Standard OPD/consultation fee (client-defined), accepted payment modes (UPI, Cash, Cards).
7. **Reception Staff Contact:** Name and mobile number of primary front-desk staff member who will manage WhatsApp Business desktop.
8. **Inquiry Data Safety Review:** Confirmation that the clinic reviews the data safety guidelines, restricts tracking to non-medical contact metadata, and establishes an internal record retention schedule.

---

## 5. 10-Minute Walkthrough & Demonstration Script

### Act 1: The Invisible Leak (Minutes 0–3)
- *"Doctor, when a patient chips a tooth at 8:30 PM on a Friday, they search Google Maps, find your clinic, and message your WhatsApp number.*
- *If nobody replies until 10:00 AM Saturday, what happens? They reach out to the next open clinic on Practo or Google Maps.*
- *In our Day 1 intake audit, we measure your clinic's exact after-hours inquiry volume and response delay directly from your reception logs (OWNER_MEASURED: Day 1 reception call and WhatsApp intake audit). Every un-replied evening inquiry risks becoming a lost patient chair."*

### Act 2: The Solution Demonstration (Minutes 3–7)
- Show live WhatsApp Business away message on phone: *"Watch what happens when I message your clinic number right now at 9:00 PM."*
- Demonstrate instant auto-reply:
  > *"Hello! Thank you for contacting Dr. Sharma's Dental Care. Our clinic is currently closed (Hours: Mon-Sat 9 AM - 8 PM).*  
  > *To request an appointment for tomorrow morning, reply 1.*  
  > *For treatment fee information, reply 2.*  
  > *For acute dental emergencies, call our on-call doctor at +91-98490-XXXXX."*
- Show reception desktop quick replies: type `/fee` → expands instantly into full treatment pricing and consultation details.

### Act 3: Handover & Next Steps (Minutes 7–10)
- *"We set this entire system up on your existing phone in 4 hours. No new software to buy, no monthly cloud bills. We provide the setup, the staff training, and weekly inquiry reports."*
- Present commercial pilot terms for owner review.

---

## 6. Synthetic Demo Dashboard Schema (`SYNTHETIC_DEMO`)

> **DATA PRIVACY NOTICE:** The following schema is strictly synthetic demonstration data for sales walkthroughs. Zero real patient PII.

```json
{
  "_classification": "SYNTHETIC_DEMO",
  "clinicName": "Apex Dental Clinic (Demo)",
  "period": "Last 7 Days (Synthetic Walkthrough)",
  "metrics": {
    "totalInquiriesReceived": 28,
    "inquiriesOutsideClinicHours": 12,
    "automatedTriageTriggered": 12,
    "medianResponseDelayMinutes": {
      "withTriageGreeting": 0.5,
      "withoutTriageHistorical": 285
    },
    "appointmentsBooked": 19,
    "showUpRatePercent": 84.2,
    "topInquiryTopics": [
      { "topic": "Root Canal Treatment Fee", "count": 11 },
      { "topic": "Emergency Tooth Pain", "count": 6 },
      { "topic": "Clinic Timings & Location", "count": 5 },
      { "topic": "Braces / Aligners Consultation", "count": 4 }
    ]
  }
}
```

---

## 7. 5-Day Delivery & Milestones Checklist

- [ ] **Day 1: Kickoff & Profile Setup**
  - Conduct 30-min intake questionnaire.
  - Verify client phone has WhatsApp Business App installed.
  - Configure clinic logo, address, categories, and business hours.
- [ ] **Day 2: Messaging Automation & Quick Replies**
  - Configure automated greeting message.
  - Configure automated away message with working hours and emergency protocol.
  - Input top 10 quick-reply templates (`/fee`, `/location`, `/hours`, etc.).
- [ ] **Day 3: Label Taxonomy & Inquiry Tracking Sheet**
  - Configure 5 color-coded labels on WhatsApp Business App.
  - Create shared Google Sheet (`[Clinic Name] - Lead & Response SLA Tracker`).
  - Link calendar booking system (Google Calendar / Cal.com free tier).
- [ ] **Day 4: Google Business Profile Audit & Staff Training**
  - Audit GBP profile information and insert WhatsApp click-to-chat CTA link.
  - 45-minute live staff walkthrough with reception: simulate 3 patient scenarios.
- [ ] **Day 5: Handover Acceptance & First Report**
  - Perform live verification test from external phone.
  - Deliver Client Handover Document & sign handover acceptance.
  - Schedule first weekly conversion performance report.

---

## 8. Handover Acceptance Checklist

The pilot is officially complete and accepted when the client signs off on each item:

- [ ] **H1:** Test message sent outside working hours receives the automated away message with emergency instructions.
- [ ] **H2:** Receptionist successfully responds to a simulated patient fee inquiry using `/fee` in under 30 seconds.
- [ ] **H3:** Receptionist successfully tags an appointment with the orange `Appointment Booked` label.
- [ ] **H4:** Test appointment successfully appears on the shared clinic calendar.
- [ ] **H5:** Google Business Profile includes the active WhatsApp Click-to-Chat URL.
- [ ] **H6:** Shared Google Sheet is bookmarked on reception PC and accessible to clinic owner.

---

## 9. Post-Delivery Invoicing & Financial Reconciliation

- **Pricing Status:** Price: TBD. Owner decides.
- **Payment Method Options:**
  - **Option 1 (Direct UPI QR / VPA):** Client scans owner UPI QR (`venkatasaiharsh149768.rzp@rxairtel`) or transfers to VPA. Client submits UTR; owner verifies bank statement credit.
  - **Option 2 (Razorpay Link):** Dynamic provider payment link generated for exact invoice amount.
- **Verification Rule:** Zero revenue is recognized in internal ledgers until provider capture webhook or owner bank statement credit is confirmed.

---

## 10. Clinic Inquiry-Data Safety (Legal Review Draft)

> **IMPORTANT NOTICE:**  
> **Draft. Not legal advice. A lawyer must review it before use.**  
> This draft does not claim compliance with any law and does not state that it satisfies the Digital Personal Data Protection Act (DPDP Act) or any other legal or regulatory requirement without appropriate qualified legal review.

### 10.1 Ownership and Control
- The clinic owns and controls its WhatsApp Business account, device, and inquiry sheet at all times.
- The service provider acts solely as a configuration setup assistant under the clinic's direction and documented authorization.

### 10.2 Strict Data Minimization
- The shared inquiry tracker sheet captures strictly minimal operational metadata:
  1. Prospective patient first name
  2. Phone number / WhatsApp contact handle
  3. Timestamp received
  4. Timestamp answered
  5. Inquiry status (e.g., New Inquiry, Consultation Booked, Follow-Up Needed)
- **Prohibited Data:** Do not record or store medical symptoms, diagnostic details, clinical notes, treatment history, photographs, prescriptions, medical documents, government identification numbers, or unnecessary sensitive personal information in this sheet or any shared tracker.

### 10.3 Access Authorization and Revocation
- The service provider / owner receives temporary access to the tracking sheet only with the clinic's explicit, documented authorization.
- Provider access is revoked immediately upon completion of handover (Day 5) or earlier if no longer required.
- The clinic retains exclusive administrative rights to all accounts and documents.

### 10.4 Retention, Deletion, and Copies
- The clinic is solely responsible for access control, retention policy, and deletion schedules for all records it controls.
- Retention periods and specific deletion steps must be determined and documented by the clinic before operational use.
- The deletion process must explicitly account for access removal, shared copies, local downloads, spreadsheet export files, and automated backups.

