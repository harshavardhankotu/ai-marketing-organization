import { getDb } from '../db/client.js';
import { LocalLandingPageRecord } from '@ai-marketing/shared';

export class LocalLandingPageEngine {
  private get db() {
    return getDb();
  }

  /**
   * Retrieves all verified local landing pages.
   */
  public listLandingPages(): LocalLandingPageRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM local_landing_pages ORDER BY slug ASC')
      .all() as any[];

    return rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      clinicName: r.clinic_name,
      location: r.location,
      service: r.service,
      contactPhone: r.contact_phone,
      whatsappNumber: r.whatsapp_number,
      ctaText: r.cta_text,
      canonicalUrl: r.canonical_url,
      metaDescription: r.meta_description,
      appointmentPath: r.appointment_path,
      verifiedDoctor: r.verified_doctor,
      address: r.address,
    }));
  }

  /**
   * Retrieves a landing page by slug.
   */
  public getLandingPage(slug: string): LocalLandingPageRecord | null {
    const cleanSlug = slug.replace(/^\/+/, '');
    const row = this.db
      .prepare('SELECT * FROM local_landing_pages WHERE slug = ?')
      .get(cleanSlug) as any;

    if (!row) return null;

    return {
      slug: row.slug,
      title: row.title,
      clinicName: row.clinic_name,
      location: row.location,
      service: row.service,
      contactPhone: row.contact_phone,
      whatsappNumber: row.whatsapp_number,
      ctaText: row.cta_text,
      canonicalUrl: row.canonical_url,
      metaDescription: row.meta_description,
      appointmentPath: row.appointment_path,
      verifiedDoctor: row.verified_doctor,
      address: row.address,
    };
  }

  /**
   * Generates Schema.org LocalBusiness structured JSON-LD for local SEO.
   */
  public generateJsonLd(page: LocalLandingPageRecord): Record<string, unknown> {
    return {
      '@context': 'https://schema.org',
      '@type': 'Dentist',
      name: page.clinicName,
      description: page.metaDescription,
      url: page.canonicalUrl,
      telephone: page.contactPhone,
      address: {
        '@type': 'PostalAddress',
        streetAddress: page.address,
        addressLocality: 'Hyderabad',
        addressRegion: 'Telangana',
        postalCode: '500034',
        addressCountry: 'IN',
      },
      medicalSpecialty: 'Orthodontics',
      employee: {
        '@type': 'Person',
        name: page.verifiedDoctor,
      },
      priceRange: '₹₹₹',
      hasOfferCatalog: {
        '@type': 'OfferCatalog',
        name: 'Clear Aligner Services',
        itemListElement: [
          {
            '@type': 'Offer',
            itemOffered: {
              '@type': 'Service',
              name: page.service,
            },
          },
        ],
      },
    };
  }
}
