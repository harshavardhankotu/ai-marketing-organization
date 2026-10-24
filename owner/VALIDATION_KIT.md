# PILOT VALIDATION KIT & ACCEPTANCE TESTING PROTOCOL
=====================================================================

> **AUDIENCE:** Owner operational guide for verifying and accepting the First Paid Indian SMB Pilot.  
> **DELIVERY MODEL:** 100% free, client-owned tools (WhatsApp Business App, Google Sheets, Cal.com/Google Calendar, Google Business Profile).  
> **GOVERNANCE:** Zero phantom features, zero unbacked rupee estimates, zero automated outreach.

---

## 1. Pre-Flight Verification Checklist

Before onboarding a clinic, verify that the following prerequisites are met:

1. **Client Ownership:** The clinic owns the mobile phone and registered phone number.
2. **Free Tools Confirmed:** WhatsApp Business app downloaded from official App Store / Google Play (Cost: ₹0).
3. **No Third-Party APIs:** No Twilio, WhatsApp Cloud API, or BSP subscriptions required.
4. **Data Minimization Agreement:** Clinic agrees to record only first name, phone, timestamp, and status. No medical notes or symptoms recorded in shared sheets.
5. **Commercial Agreement:** `Price: TBD. Owner decides.` Owner confirms commercial fee and payment mode directly with client.

---

## 2. Acceptance Test Scenarios (Live Smoke Tests)

| Test ID | Scenario | Test Input / Action | Expected Result | Verification Mode |
|:---:|---|---|---|---|
| **V1** | **After-Hours Triage** | Send test message outside operating hours (e.g. 8:30 PM) | Automated away message delivered with operating hours and emergency contact protocol | `MANUAL_BY_OWNER` |
| **V2** | **Reception Quick-Reply** | Reception staff types `/fee` in chat | Shortcut expands instantly into standard clinic consultation fee and payment options | `MANUAL_BY_OWNER` |
| **V3** | **Emergency Escalation** | Test emergency keyword reach-out | Clear emergency protocol phone number provided for acute medical situations | `MANUAL_BY_OWNER` |
| **V4** | **Pipeline Labeling** | Receptionist tags inquiry | Blue `New Inquiry` label applied; converted to Orange `Appointment Booked` | `MANUAL_BY_OWNER` |
| **V5** | **Lead Tracker Logging** | Log simulated inquiry in Google Sheet | Row captures first name, phone, timestamp received, response delay, and status | `MANUAL_BY_OWNER` |
| **V6** | **Calendar Slot Booking** | Click self-service booking link | Appointment slots reflect actual practitioner chair availability | `MANUAL_BY_OWNER` |
| **V7** | **Google Profile CTA** | Click WhatsApp link in GBP contact | Opens WhatsApp conversation with pre-filled appointment request template | `MANUAL_BY_OWNER` |
| **V8** | **Access Revocation** | Day 5 Handover Acceptance | Provider shared access to Google Sheet revoked; client retains exclusive admin rights | `MANUAL_BY_OWNER` |

---

## 3. Synthetic Demonstration Schema (`SYNTHETIC_DEMO`)

> **DEMO DATA ONLY:** All figures below are synthetic walkthrough fixtures for sales demonstrations. They are not real client data, verified results, or guaranteed metrics.

```json
{
  "_classification": "SYNTHETIC_DEMO",
  "clinicName": "Apex Dental Clinic (Demo Walkthrough)",
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

## 4. Handover Sign-Off Form

The pilot is officially accepted when the clinic director signs off on the following:

- [ ] All 8 acceptance scenarios (V1–V8) verified on clinic reception hardware.
- [ ] Front-desk staff trained on quick replies (`/fee`, `/hours`, `/location`, `/book`).
- [ ] Provider access to shared sheets and tools revoked.
- [ ] Client confirms receipt of Inquiry Data Safety Guidelines (Draft. Not legal advice).
