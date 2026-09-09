// India-First Domain Constants & Utilities

export type IndianLanguage = 
  | 'English'
  | 'Hindi'
  | 'Telugu'
  | 'Tamil'
  | 'Kannada'
  | 'Malayalam'
  | 'Marathi'
  | 'Bengali'
  | 'Gujarati'
  | 'Punjabi';

export const INDIAN_LANGUAGES: { code: string; name: IndianLanguage; nativeName: string }[] = [
  { code: 'en-IN', name: 'English', nativeName: 'English' },
  { code: 'hi-IN', name: 'Hindi', nativeName: 'हिन्दी' },
  { code: 'te-IN', name: 'Telugu', nativeName: 'తెలుగు' },
  { code: 'ta-IN', name: 'Tamil', nativeName: 'தமிழ்' },
  { code: 'kn-IN', name: 'Kannada', nativeName: 'ಕನ್ನಡ' },
  { code: 'ml-IN', name: 'Malayalam', nativeName: 'മലയാളം' },
  { code: 'mr-IN', name: 'Marathi', nativeName: 'मराठी' },
  { code: 'bn-IN', name: 'Bengali', nativeName: 'বাংলা' },
  { code: 'gu-IN', name: 'Gujarati', nativeName: 'ગુજરાતી' },
  { code: 'pa-IN', name: 'Punjabi', nativeName: 'ਪੰਜਾਬੀ' },
];

export interface IndianCity {
  name: string;
  state: string;
  tier: 1 | 2 | 3;
  primaryLanguages: IndianLanguage[];
  keyLocalities: string[];
}

export const INDIAN_CITIES: IndianCity[] = [
  {
    name: 'Hyderabad',
    state: 'Telangana',
    tier: 1,
    primaryLanguages: ['Telugu', 'English', 'Hindi'],
    keyLocalities: ['Banjara Hills', 'Jubilee Hills', 'Gachibowli', 'Hitec City', 'Madhapur', 'Kukatpally', 'Secunderabad', 'Ameerpet', 'Dilsukhnagar', 'Kondapur']
  },
  {
    name: 'Bengaluru',
    state: 'Karnataka',
    tier: 1,
    primaryLanguages: ['Kannada', 'English', 'Hindi', 'Tamil', 'Telugu'],
    keyLocalities: ['Indiranagar', 'Koramangala', 'HSR Layout', 'Whitefield', 'Jayanagar', 'JP Nagar', 'Electronic City', 'Malleshwaram']
  },
  {
    name: 'Mumbai',
    state: 'Maharashtra',
    tier: 1,
    primaryLanguages: ['Marathi', 'Hindi', 'English', 'Gujarati'],
    keyLocalities: ['Bandra', 'Andheri', 'Juhu', 'Powai', 'Colaba', 'Borivali', 'Thane', 'Navi Mumbai']
  },
  {
    name: 'Delhi NCR',
    state: 'Delhi',
    tier: 1,
    primaryLanguages: ['Hindi', 'English', 'Punjabi'],
    keyLocalities: ['South Extension', 'Connaught Place', 'Gurugram Cyber Hub', 'Noida Sector 18', 'Dwarka', 'Lajpat Nagar', 'Rohini']
  },
  {
    name: 'Chennai',
    state: 'Tamil Nadu',
    tier: 1,
    primaryLanguages: ['Tamil', 'English'],
    keyLocalities: ['T Nagar', 'Adyar', 'Anna Nagar', 'Velachery', 'Nungambakkam', 'OMR', 'Mylapore']
  },
  {
    name: 'Pune',
    state: 'Maharashtra',
    tier: 1,
    primaryLanguages: ['Marathi', 'English', 'Hindi'],
    keyLocalities: ['Kothrud', 'Viman Nagar', 'Baner', 'Kalyani Nagar', 'Hinjewadi', 'Aundh']
  },
  {
    name: 'Kolkata',
    state: 'West Bengal',
    tier: 1,
    primaryLanguages: ['Bengali', 'English', 'Hindi'],
    keyLocalities: ['Park Street', 'Salt Lake', 'New Town', 'Ballygunge', 'Howrah']
  },
  {
    name: 'Ahmedabad',
    state: 'Gujarat',
    tier: 1,
    primaryLanguages: ['Gujarati', 'Hindi', 'English'],
    keyLocalities: ['Satellite', 'SG Highway', 'Bodakdev', 'Vastrapur', 'Navrangpura']
  },
  {
    name: 'Visakhapatnam',
    state: 'Andhra Pradesh',
    tier: 2,
    primaryLanguages: ['Telugu', 'English'],
    keyLocalities: ['MVP Colony', 'Siripuram', 'Gajuwaka', 'Madhurawada']
  },
  {
    name: 'Jaipur',
    state: 'Rajasthan',
    tier: 2,
    primaryLanguages: ['Hindi', 'English'],
    keyLocalities: ['Malviya Nagar', 'Vaishali Nagar', 'C-Scheme', 'Mansarovar']
  },
  {
    name: 'Coimbatore',
    state: 'Tamil Nadu',
    tier: 2,
    primaryLanguages: ['Tamil', 'English'],
    keyLocalities: ['RS Puram', 'Gandhipuram', 'Peelamedu', 'Saibaba Colony']
  }
];

export interface BusinessVertical {
  id: string;
  name: string;
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH';
  leadToAppointmentCycleDays: number;
  typicalTicketSizeINR: [number, number];
  primaryChannels: string[];
  complianceNotes: string;
}

export const INDIAN_SMB_VERTICALS: Record<string, BusinessVertical> = {
  HEALTHCARE_DENTAL: {
    id: 'HEALTHCARE_DENTAL',
    name: 'Dental Clinics & Orthodontics',
    riskTier: 'HIGH',
    leadToAppointmentCycleDays: 7,
    typicalTicketSizeINR: [1500, 75000],
    primaryChannels: ['WhatsApp', 'Google_Business_Profile', 'Instagram', 'Search_Ads'],
    complianceNotes: 'Do not promise 100% cure, avoid fabricated before/after photos, no guaranteed painless claims without disclaimer.'
  },
  HEALTHCARE_CLINIC: {
    id: 'HEALTHCARE_CLINIC',
    name: 'Clinics, Diagnostics & Wellness',
    riskTier: 'HIGH',
    leadToAppointmentCycleDays: 3,
    typicalTicketSizeINR: [500, 25000],
    primaryChannels: ['WhatsApp', 'Google_Business_Profile', 'Search_Ads'],
    complianceNotes: 'Medical Council of India compliance: no misleading guarantees or unproven clinical claims.'
  },
  REAL_ESTATE: {
    id: 'REAL_ESTATE',
    name: 'Real Estate Builders & Brokers',
    riskTier: 'MEDIUM',
    leadToAppointmentCycleDays: 30,
    typicalTicketSizeINR: [3500000, 25000000],
    primaryChannels: ['WhatsApp', 'Facebook_Ads', 'Instagram', 'Search_Ads'],
    complianceNotes: 'RERA registration number mandatory on all promotional ads.'
  },
  EDUCATION_COACHING: {
    id: 'EDUCATION_COACHING',
    name: 'Coaching Centres & Test Prep (JEE/NEET/Civil Services)',
    riskTier: 'MEDIUM',
    leadToAppointmentCycleDays: 14,
    typicalTicketSizeINR: [20000, 150000],
    primaryChannels: ['YouTube', 'Instagram', 'WhatsApp', 'Search_Ads'],
    complianceNotes: 'ASCI guidelines: only substantiate rank holder claims with audited proof.'
  },
  SALON_SPA: {
    id: 'SALON_SPA',
    name: 'Salons, Spas & Aesthetic Care',
    riskTier: 'LOW',
    leadToAppointmentCycleDays: 2,
    typicalTicketSizeINR: [800, 15000],
    primaryChannels: ['Instagram', 'WhatsApp', 'Google_Business_Profile'],
    complianceNotes: 'Authentic pricing transparency; clear package inclusions.'
  },
  RESTAURANT_CAFE: {
    id: 'RESTAURANT_CAFE',
    name: 'Restaurants, Cafes & Cloud Kitchens',
    riskTier: 'LOW',
    leadToAppointmentCycleDays: 1,
    typicalTicketSizeINR: [300, 3000],
    primaryChannels: ['Instagram', 'Google_Business_Profile', 'WhatsApp'],
    complianceNotes: 'FSSAI license mention where applicable; accurate food depictions.'
  },
  D2C_BRAND: {
    id: 'D2C_BRAND',
    name: 'D2C Consumer Brands (Ayurveda, Fashion, Foods)',
    riskTier: 'MEDIUM',
    leadToAppointmentCycleDays: 3,
    typicalTicketSizeINR: [499, 4999],
    primaryChannels: ['Meta_Ads', 'Instagram', 'WhatsApp', 'Search_Ads', 'Email'],
    complianceNotes: 'Consumer Protection Act (E-Commerce Rules): transparent refund and return policies.'
  },
  FITNESS_GYM: {
    id: 'FITNESS_GYM',
    name: 'Gyms, Crossfit & Fitness Studios',
    riskTier: 'LOW',
    leadToAppointmentCycleDays: 5,
    typicalTicketSizeINR: [2500, 35000],
    primaryChannels: ['Instagram', 'WhatsApp', 'Google_Business_Profile'],
    complianceNotes: 'No extreme transformational guarantees without trainer certification disclosures.'
  }
};

export const INDIAN_FESTIVALS_SEASONALITY = [
  { name: 'Diwali & Dhanteras', peakMonths: [10, 11], impact: 'Peak buying period across retail, gold, electronics, real estate, aesthetics' },
  { name: 'Sankranti / Pongal / Lohri', peakMonths: [1], impact: 'Major harvest festival boost in South and North India' },
  { name: 'Eid al-Fitr', peakMonths: [3, 4], impact: 'Strong consumer goods, dining, fashion, and festive gifting uplift' },
  { name: 'Onam', peakMonths: [8, 9], impact: 'Massive Kerala shopping and consumer demand cycle' },
  { name: 'Durga Puja / Navratri', peakMonths: [9, 10], impact: 'East & West India premier festive consumption window' },
  { name: 'Wedding Season (Muhurtham)', peakMonths: [11, 12, 1, 2, 5], impact: 'Massive demand for dental aesthetic smile makeovers, salons, jewellery, venues' }
];

export function formatINR(amount: number): string {
  if (isNaN(amount) || amount === null || amount === undefined) return '₹0';
  if (amount >= 10000000) {
    const cr = (amount / 10000000).toFixed(2);
    return `₹${cr.replace(/\.00$/, '')} Cr`;
  }
  if (amount >= 100000) {
    const lakh = (amount / 100000).toFixed(2);
    return `₹${lakh.replace(/\.00$/, '')} Lakh`;
  }
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0
  }).format(amount);
}