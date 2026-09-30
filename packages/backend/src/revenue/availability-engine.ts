import { D1RevenueRepository } from '../db/d1-revenue-repository.js';
import { AvailabilitySlot, BookingReservation } from '@ai-marketing/shared';

import { isProduction } from '../config/env.js';

export interface AvailabilityQueryOptions {
  startDate?: string;
  endDate?: string;
  resourceId?: string;
  resourceType?: string;
}

export function localTimeToUtcIso(dateStr: string, hour: number, minute: number, timeZone: string = 'UTC'): string {
  const hhStr = String(hour).padStart(2, '0');
  const mmStr = String(minute).padStart(2, '0');
  const guess = new Date(`${dateStr}T${hhStr}:${mmStr}:00.000Z`);
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
      hour12: false
    });
    const parts = dtf.formatToParts(guess);
    const p: Record<string, string> = {};
    parts.forEach(({ type, value }) => { p[type] = value; });
    const targetLocalH = hour;
    const targetLocalM = minute;
    const actualLocalH = parseInt(p.hour === '24' ? '0' : p.hour, 10);
    const actualLocalM = parseInt(p.minute, 10);
    const diffMinutes = (targetLocalH * 60 + targetLocalM) - (actualLocalH * 60 + actualLocalM);
    const adjusted = new Date(guess.getTime() + diffMinutes * 60 * 1000);
    return adjusted.toISOString();
  } catch {
    return guess.toISOString();
  }
}

export interface ReservationRequest {
  businessId: string;
  slotId?: string;
  preferredDate?: string;
  preferredTime?: string;
  customerName: string;
  customerContact: string;
  customerEmail?: string;
  serviceTitle?: string;
  funnelId?: string;
  metadata?: Record<string, any>;
}

export interface ReservationResult {
  success: boolean;
  status: 'CONFIRMED' | 'PENDING_CONFIRMATION' | 'UNAVAILABLE' | 'CONFLICT' | 'BLOCKED';
  reservation?: BookingReservation;
  error?: string;
}

export interface AvailabilityProvider {
  getAvailability(businessId: string, options?: AvailabilityQueryOptions): Promise<AvailabilitySlot[]>;
  reserveSlot(params: ReservationRequest): Promise<ReservationResult>;
  releaseSlot(slotId: string, reservationId: string): Promise<boolean>;
  cancelReservation(reservationId: string, reason?: string): Promise<boolean>;
}

export class AvailabilityEngine implements AvailabilityProvider {
  private static instance: AvailabilityEngine;
  private repo = D1RevenueRepository.getInstance();

  public static getInstance(): AvailabilityEngine {
    if (!AvailabilityEngine.instance) {
      AvailabilityEngine.instance = new AvailabilityEngine();
    }
    return AvailabilityEngine.instance;
  }

  /**
   * Generates or seeds authoritative slots for a business across a number of future days.
   * Uses business timezone and standard business hours (09:00 - 17:00 in 30min slots).
   */
  public async seedDefaultSlots(
    businessId: string,
    organizationId: string,
    daysAhead: number = 7,
    timezone: string = 'UTC'
  ): Promise<AvailabilitySlot[]> {
    const createdSlots: AvailabilitySlot[] = [];
    const now = new Date();

    for (let dayOffset = 1; dayOffset <= daysAhead; dayOffset++) {
      const d = new Date(now.getTime() + dayOffset * 24 * 3600 * 1000);
      const yyyy = d.getUTCFullYear();
      const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
      const dd = String(d.getUTCDate()).padStart(2, '0');
      const datePrefix = `${yyyy}-${mm}-${dd}`;

      const hours = [9, 10, 11, 13, 14, 15, 16];
      for (const h of hours) {
        for (const m of [0, 30]) {
          const hhStr = String(h).padStart(2, '0');
          const mmStr = String(m).padStart(2, '0');
          const startIso = localTimeToUtcIso(datePrefix, h, m, timezone);
          
          const endD = new Date(new Date(startIso).getTime() + 30 * 60 * 1000);
          const endIso = endD.toISOString();
          const slotId = `slot_${businessId}_${datePrefix.replace(/-/g, '')}_${hhStr}${mmStr}`;

          // Check if slot already exists
          const existing = await this.repo.queryOne<any>(
            'availability_slots',
            `SELECT id FROM availability_slots WHERE id = ?`,
            [slotId]
          );

          if (!existing) {
            await this.repo.executeWrite(
              'availability_slots',
              `INSERT INTO availability_slots (
                id, business_id, organization_id, resource_id, resource_type,
                start_time, end_time, capacity, reserved_count, is_available,
                created_at, updated_at
              ) VALUES (?, ?, ?, 'default_practitioner', 'STAFF', ?, ?, 1, 0, 1, datetime('now'), datetime('now'))`,
              [slotId, businessId, organizationId, startIso, endIso]
            );

            createdSlots.push({
              slotId,
              businessId,
              resourceId: 'default_practitioner',
              resourceType: 'STAFF',
              startTime: startIso,
              endTime: endIso,
              isAvailable: true,
              capacity: 1,
              reservedCount: 0
            });
          }
        }
      }
    }

    return createdSlots;
  }

  /**
   * Retrieves available appointment slots for a given business.
   */
  public async getAvailability(
    businessId: string,
    options?: AvailabilityQueryOptions
  ): Promise<AvailabilitySlot[]> {
    let sql = `
      SELECT * FROM availability_slots
      WHERE business_id = ? AND is_available = 1 AND reserved_count < capacity
    `;
    const params: any[] = [businessId];

    if (options?.startDate) {
      sql += ` AND start_time >= ?`;
      params.push(options.startDate);
    }
    if (options?.endDate) {
      sql += ` AND end_time <= ?`;
      params.push(options.endDate);
    }
    if (options?.resourceId) {
      sql += ` AND resource_id = ?`;
      params.push(options.resourceId);
    }
    if (options?.resourceType) {
      sql += ` AND resource_type = ?`;
      params.push(options.resourceType);
    }

    sql += ` ORDER BY start_time ASC LIMIT 100`;

    const rows = await this.repo.query<any>('availability_slots', sql, params);

    if (rows && rows.length > 0) {
      return rows.map(r => ({
        slotId: r.id,
        businessId: r.business_id,
        resourceId: r.resource_id,
        resourceType: r.resource_type || 'STAFF',
        startTime: r.start_time,
        endTime: r.end_time,
        isAvailable: Boolean(r.is_available) && (r.reserved_count < r.capacity),
        capacity: Number(r.capacity || 1),
        reservedCount: Number(r.reserved_count || 0)
      }));
    }

    // In production, availability must be explicitly created. Never auto-seed synthetic slots on query.
    if (isProduction() && !process.env.VITEST) {
      return [];
    }

    // Auto-seed in dev/test if business exists and slots are empty
    const biz = await this.repo.queryOne<any>(
      'businesses',
      `SELECT id, organization_id, timezone FROM businesses WHERE id = ?`,
      [businessId]
    );
    if (biz) {
      return await this.seedDefaultSlots(biz.id, biz.organization_id, 7, biz.timezone || 'UTC');
    }

    return [];
  }

  /**
   * Concurrency-safe atomic reservation against authoritative slot records.
   * Double booking is impossible due to atomic conditional update.
   */
  public async reserveSlot(params: ReservationRequest): Promise<ReservationResult> {
    const { businessId, slotId, customerName, customerContact, customerEmail, serviceTitle } = params;

    if (!businessId) {
      return { success: false, status: 'BLOCKED', error: 'BUSINESS_REQUIRED: Valid businessId is required.' };
    }
    if (!customerName || !customerContact) {
      return { success: false, status: 'BLOCKED', error: 'CONTACT_REQUIRED: customerName and customerContact are required.' };
    }

    // 1. Resolve authoritative slot
    let targetSlot: any = null;
    if (slotId) {
      targetSlot = await this.repo.queryOne<any>(
        'availability_slots',
        `SELECT * FROM availability_slots WHERE id = ?`,
        [slotId]
      );
    } else if (params.preferredDate) {
      if (params.preferredTime) {
        const allDateSlots = await this.repo.query<any>(
          'availability_slots',
          `SELECT * FROM availability_slots 
           WHERE business_id = ? AND start_time LIKE ? AND is_available = 1 AND reserved_count < capacity
           ORDER BY start_time ASC`,
          [businessId, `${params.preferredDate}%`]
        );

        if (allDateSlots.length === 0) {
          return {
            success: false,
            status: 'UNAVAILABLE',
            error: `NO_AVAILABILITY_ON_DATE: No available appointment slots on date ${params.preferredDate}.`
          };
        }

        const timeMatch = params.preferredTime.match(/(\d{1,2}):(\d{2})/);
        if (timeMatch) {
          const targetMin = parseInt(timeMatch[1], 10) * 60 + parseInt(timeMatch[2], 10);
          let closestSlot: any = null;
          let minDiff = Infinity;

          for (const s of allDateSlots) {
            const slotD = new Date(s.start_time);
            const slotMin = slotD.getUTCHours() * 60 + slotD.getUTCMinutes();
            const diff = Math.abs(slotMin - targetMin);
            if (diff < minDiff) {
              minDiff = diff;
              closestSlot = s;
            }
          }

          if (minDiff <= 45 && closestSlot) {
            targetSlot = closestSlot;
          } else {
            return {
              success: false,
              status: 'UNAVAILABLE',
              error: `TIME_NOT_AVAILABLE: No appointment slot available near requested time '${params.preferredTime}'.`
            };
          }
        } else {
          targetSlot = allDateSlots[0];
        }
      } else {
        // Find slot matching date
        targetSlot = await this.repo.queryOne<any>(
          'availability_slots',
          `SELECT * FROM availability_slots 
           WHERE business_id = ? AND start_time LIKE ? AND is_available = 1 AND reserved_count < capacity
           ORDER BY start_time ASC LIMIT 1`,
          [businessId, `${params.preferredDate}%`]
        );
      }
    }

    if (!targetSlot) {
      return {
        success: false,
        status: 'UNAVAILABLE',
        error: `SLOT_NOT_FOUND: The requested appointment slot '${slotId || ''}' was not found in the availability engine.`
      };
    }

    // 2. Multi-tenant boundary check: verify slot belongs to the target business
    if (targetSlot.business_id !== businessId) {
      return {
        success: false,
        status: 'BLOCKED',
        error: `SECURITY_VIOLATION: Slot '${targetSlot.id}' does not belong to business '${businessId}'. Cross-tenant booking rejected.`
      };
    }

    // 3. Status and capacity check
    if (targetSlot.is_available !== 1) {
      return {
        success: false,
        status: 'UNAVAILABLE',
        error: 'SLOT_INACTIVE: This appointment slot is marked unavailable by the provider.'
      };
    }

    if (Number(targetSlot.reserved_count) >= Number(targetSlot.capacity)) {
      return {
        success: false,
        status: 'UNAVAILABLE',
        error: 'SLOT_FULL: This appointment slot has already reached maximum capacity.'
      };
    }

    // 4. Overlapping duplicate check for same customer contact in the same slot
    const existingRes = await this.repo.queryOne<any>(
      'booking_reservations',
      `SELECT id FROM booking_reservations 
       WHERE business_id = ? AND slot_id = ? AND customer_contact = ? AND status = 'CONFIRMED'`,
      [businessId, targetSlot.id, customerContact]
    );

    if (existingRes) {
      return {
        success: false,
        status: 'CONFLICT',
        error: 'DUPLICATE_RESERVATION: A confirmed reservation for this contact already exists in this slot.'
      };
    }

    // 5. ATOMIC SQL UPDATE: Concurrency-safe slot reservation
    // Only succeeds if reserved_count < capacity at execution time
    const updateResult = await this.repo.executeWrite(
      'availability_slots',
      `UPDATE availability_slots 
       SET reserved_count = reserved_count + 1, updated_at = datetime('now')
       WHERE id = ? AND is_available = 1 AND reserved_count < capacity`,
      [targetSlot.id]
    );

    if (updateResult.rowsAffected === 0) {
      return {
        success: false,
        status: 'CONFLICT',
        error: 'CONCURRENCY_CONFLICT: The appointment slot was booked concurrently and is no longer available.'
      };
    }

    // 6. Write confirmed reservation with server-authoritative timestamps from slot
    const reservationId = `res_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    let organizationId = targetSlot.organization_id;
    if (!organizationId) {
      const biz = await this.repo.queryOne<any>('businesses', `SELECT organization_id FROM businesses WHERE id = ?`, [businessId]);
      organizationId = biz?.organization_id;
    }
    if (!organizationId) {
      // Rollback reservation counter if organization cannot be resolved
      await this.repo.executeWrite(
        'availability_slots',
        `UPDATE availability_slots SET reserved_count = MAX(0, reserved_count - 1), updated_at = datetime('now') WHERE id = ?`,
        [targetSlot.id]
      ).catch(() => {});
      return {
        success: false,
        status: 'BLOCKED',
        error: 'TENANT_NOT_FOUND: Organization identity could not be resolved for booking.'
      };
    }

    try {
      await this.repo.executeWrite(
        'booking_reservations',
        `INSERT INTO booking_reservations (
          id, business_id, organization_id, slot_id,
          customer_name, customer_contact, customer_email, service_title,
          status, start_time, end_time, metadata_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?, ?, datetime('now'), datetime('now'))`,
        [
          reservationId,
          businessId,
          organizationId,
          targetSlot.id,
          customerName.trim(),
          customerContact.trim(),
          customerEmail ? customerEmail.trim() : null,
          serviceTitle || 'Service Consultation',
          targetSlot.start_time, // Server authoritative!
          targetSlot.end_time,   // Server authoritative!
          JSON.stringify(params.metadata || {})
        ]
      );
    } catch (insertErr: any) {
      // Compensating rollback on failure
      await this.repo.executeWrite(
        'availability_slots',
        `UPDATE availability_slots SET reserved_count = MAX(0, reserved_count - 1), updated_at = datetime('now') WHERE id = ?`,
        [targetSlot.id]
      ).catch(e => console.error(`[CRITICAL] Failed compensating rollback for slot ${targetSlot.id}: ${e.message}`));

      throw insertErr;
    }

    const reservation: BookingReservation = {
      id: reservationId,
      businessId,
      organizationId,
      slotId: targetSlot.id,
      customerName: customerName.trim(),
      customerContact: customerContact.trim(),
      serviceTitle: serviceTitle || 'Service Consultation',
      status: 'CONFIRMED',
      startTime: targetSlot.start_time,
      endTime: targetSlot.end_time,
      metadata: params.metadata || {},
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    return {
      success: true,
      status: 'CONFIRMED',
      reservation
    };
  }

  /**
   * Releases an appointment slot and marks reservation cancelled.
   */
  public async releaseSlot(slotId: string, reservationId: string): Promise<boolean> {
    // 1. Decrement reserved_count atomically
    await this.repo.executeWrite(
      'availability_slots',
      `UPDATE availability_slots 
       SET reserved_count = MAX(0, reserved_count - 1), updated_at = datetime('now')
       WHERE id = ?`,
      [slotId]
    );

    // 2. Mark reservation CANCELLED
    await this.repo.executeWrite(
      'booking_reservations',
      `UPDATE booking_reservations SET status = 'CANCELLED', updated_at = datetime('now') WHERE id = ?`,
      [reservationId]
    );

    return true;
  }

  /**
   * Cancels a booking reservation with audit reason.
   */
  public async cancelReservation(reservationId: string, reason?: string): Promise<boolean> {
    const res = await this.repo.queryOne<any>(
      'booking_reservations',
      `SELECT * FROM booking_reservations WHERE id = ?`,
      [reservationId]
    );
    if (!res) return false;

    return await this.releaseSlot(res.slot_id, reservationId);
  }
}
