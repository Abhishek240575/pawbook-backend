/**
 * PawBook WhatsApp Route Hooks
 * Mount in your Express app: app.use('/api/v1', require('./whatsapp.routes'));
 *
 * These routes are called by the frontend (11_vet_booking.html) to trigger WA notifications.
 * They are ALSO called internally when appointment/prescription status changes in other routes.
 *
 * HOW TO WIRE INTO EXISTING ROUTES:
 *   In your existing appointment PATCH handler, add:
 *     const wa = require('./whatsapp.service')
 *     if (newStatus === 'confirmed') await wa.notifyAppointmentConfirmed({...});
 *     if (newStatus === 'cancelled') await wa.notifyAppointmentCancelled({...});
 *   In your prescription POST handler, add:
 *     await wa.sendPrescription({...});
 */

'use strict';

const express = require('express');
const router  = express.Router();
const wa                   = require('./whatsapp.service');
const { authenticate }     = require('../middleware');
const { query }            = require('../config/db');

/* ─── Helper: fetch appointment with vet + owner phone ─────────────────── */
async function getApptFull(apptId) {
  const { rows } = await query(`
    SELECT
      a.*,
      u_owner.name    AS owner_name,
      u_owner.phone   AS owner_phone,
      u_vet.name      AS vet_name,
      u_vet.phone     AS vet_phone,
      p.name          AS pet_name,
      p.breed         AS pet_breed
    FROM appointments a
    JOIN users u_owner ON u_owner.user_id = a.owner_id
    JOIN users u_vet   ON u_vet.user_id   = a.vet_id
    JOIN pets  p       ON p.pet_id        = a.pet_id
    WHERE a.appointment_id = $1
  `, [apptId]);
  return rows[0] || null;
}

/* ════════════════════════════════════════════════════════════════════════
   POST /appointments  (hook into existing route — call after DB insert)
   ════════════════════════════════════════════════════════════════════════ */
router.post('/wa/appointment-booked', authenticate, async (req, res) => {
  try {
    const { appointment_id } = req.body;
    const appt = await getApptFull(appointment_id);
    if (!appt) return res.status(404).json({ error: 'Appointment not found' });

    await wa.notifyAppointmentBooked({
      vetPhone:    appt.vet_phone,
      ownerPhone:  appt.owner_phone,
      vetName:     appt.vet_name,
      ownerName:   appt.owner_name,
      petName:     appt.pet_name,
      apptDate:    appt.appt_date,
      apptTime:    appt.appt_time,
      consultType: appt.consult_type,
      apptId:      appt.appointment_id,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[WA route] appointment-booked:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════════════
   PATCH /appointments/:id  — hook: after status update send WA
   Call this INSIDE your existing PATCH /appointments/:id handler like:
     await notifyIfStatusChanged(req, oldStatus, newStatus, body);
   ════════════════════════════════════════════════════════════════════════ */
async function notifyIfStatusChanged(apptId, newStatus, { vetNote, cancellationReason, cancelledBy }) {
  try {
    const appt = await getApptFull(apptId);
    if (!appt) return;

    if (newStatus === 'confirmed') {
      await wa.notifyAppointmentConfirmed({
        vetPhone:    appt.vet_phone,
        ownerPhone:  appt.owner_phone,
        vetName:     appt.vet_name,
        ownerName:   appt.owner_name,
        petName:     appt.pet_name,
        apptDate:    appt.appt_date,
        apptTime:    appt.appt_time,
        consultType: appt.consult_type,
        apptId:      appt.appointment_id,
        vetNote:     vetNote || '',
      });
    }

    if (newStatus === 'cancelled') {
      await wa.notifyAppointmentCancelled({
        vetPhone:    appt.vet_phone,
        ownerPhone:  appt.owner_phone,
        vetName:     appt.vet_name,
        ownerName:   appt.owner_name,
        petName:     appt.pet_name,
        apptDate:    appt.appt_date,
        apptTime:    appt.appt_time,
        cancelledBy: cancelledBy || 'owner',
        reason:      cancellationReason || '',
        apptId:      appt.appointment_id,
      });
    }
  } catch (err) {
    // WA failure must NEVER break appointment operations — log only
    console.error('[WA] notifyIfStatusChanged failed:', err.message);
  }
}

/* ════════════════════════════════════════════════════════════════════════
   POST /wa/prescription-sent  — called after vet writes a prescription
   ════════════════════════════════════════════════════════════════════════ */
router.post('/wa/prescription-sent', authenticate, async (req, res) => {
  try {
    const { prescription_id, appointment_id } = req.body;

    // Fetch prescription details
    const { rows: rxRows } = await query(`
      SELECT rx.*, a.appt_date, a.appt_time,
             u_owner.name AS owner_name, u_owner.phone AS owner_phone,
             u_vet.name   AS vet_name,   u_vet.phone   AS vet_phone,
             p.name AS pet_name, p.breed AS pet_breed
      FROM prescriptions rx
      JOIN appointments a ON a.appointment_id = rx.appointment_id
      JOIN users u_owner  ON u_owner.user_id  = a.owner_id
      JOIN users u_vet    ON u_vet.user_id    = a.vet_id
      JOIN pets p         ON p.pet_id         = a.pet_id
      WHERE rx.prescription_id = $1
    `, [prescription_id || req.body.prescriptionId]);

    const rx = rxRows[0];
    if (!rx) return res.status(404).json({ error: 'Prescription not found' });

    await wa.sendPrescription({
      vetPhone:       rx.vet_phone,
      ownerPhone:     rx.owner_phone,
      vetName:        rx.vet_name,
      ownerName:      rx.owner_name,
      petName:        rx.pet_name,
      petBreed:       rx.pet_breed,
      apptDate:       rx.appt_date,
      medicines:      rx.medicines || [],       // JSON array in DB
      instructions:   rx.instructions || '',
      followUpDate:   rx.follow_up_date || null,
      prescriptionId: rx.prescription_id,
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('[WA route] prescription-sent:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ════════════════════════════════════════════════════════════════════════
   POST /wa/sos  — pet owner sends emergency alert to vet
   No auth required so owners can send even if session expired
   ════════════════════════════════════════════════════════════════════════ */
router.post('/wa/sos', async (req, res) => {
  try {
    const {
      owner_id,         // from localStorage / JWT claim
      vet_id,           // their registered vet, or nearest
      pet_id,
      emergency_desc,   // "My dog is not breathing / vomiting blood / etc."
      owner_location,   // GPS address string if shared
    } = req.body;

    if (!emergency_desc) return res.status(400).json({ error: 'Emergency description required' });

    // Fetch contact details
    const { rows } = await query(`
      SELECT
        u_owner.name  AS owner_name, u_owner.phone AS owner_phone,
        u_vet.name    AS vet_name,   u_vet.phone   AS vet_phone,
        p.name        AS pet_name,   p.breed       AS pet_breed
      FROM users u_owner
      LEFT JOIN users u_vet ON u_vet.user_id = $2
      LEFT JOIN pets p      ON p.pet_id      = $3 AND p.owner_id = $1
      WHERE u_owner.user_id = $1
    `, [owner_id, vet_id, pet_id]);

    const info = rows[0];
    if (!info) return res.status(404).json({ error: 'User not found' });

    // Fall back to global vet WhatsApp if no registered vet
    const vetPhone = info.vet_phone || process.env.VET_WHATSAPP;
    if (!vetPhone) return res.status(400).json({ error: 'No vet phone available for SOS' });

    await wa.sendSOSAlert({
      vetPhone,
      ownerPhone:    info.owner_phone,
      ownerName:     info.owner_name,
      petName:       info.pet_name  || 'Unknown pet',
      petBreed:      info.pet_breed || '',
      emergencyDesc: emergency_desc,
      ownerLocation: owner_location || 'Not shared',
    });

    // Log SOS in DB for audit
    await query(
      `INSERT INTO sos_alerts (owner_id, vet_id, pet_id, emergency_desc, location, sent_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [owner_id, vet_id || null, pet_id || null, emergency_desc, owner_location || null]
    ).catch(e => console.warn('[WA] SOS log failed:', e.message));

    res.json({ ok: true, message: 'SOS alert sent to vet' });
  } catch (err) {
    console.error('[WA route] SOS error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = { router, notifyIfStatusChanged };
