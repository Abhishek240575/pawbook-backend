/**
 * PawBook WhatsApp Cron Jobs
 * Add this file to your backend and call startCrons() on server start.
 *
 * Requires: node-cron  →  npm install node-cron
 * Uses: whatsapp.service.js + your DB query functions
 *
 * Cron jobs:
 *   1. Every 10 hours — appointment reminders (confirmed, not yet completed)
 *   2. Every 24 hours — vaccination reminders (due in 30/7/3/1/0/-ve days)
 */

'use strict';

const cron = require('node-cron');
const wa   = require('./whatsapp.service')

// Replace these with your actual DB query functions
const { query } = require('../config/db');  // your Neon/pg pool or query helper

/* ═══════════════════════════════════════════════════════════════════════
   CRON 1 — Appointment Reminders  (every 10 hours)
   Fires at: 7 AM, 5 PM IST daily  (adjust to your preferred times)
   ═══════════════════════════════════════════════════════════════════════ */
function scheduleAppointmentReminders() {
  // '0 1,11,21 * * *'  =  7:00 AM, 5:00 PM, 3:00 AM IST  (UTC+5:30, so UTC 1:30, 11:30, 21:30)
  cron.schedule('30 1,11,21 * * *', async () => {
    console.log('[CRON] Running appointment reminder job...');
    try {
      // Fetch all confirmed appointments in the future (or today) that aren't completed
      const { rows } = await query(`
        SELECT
          a.appointment_id,
          a.appt_date,
          a.appt_time,
          a.consult_type,
          a.status,
          u_owner.name        AS owner_name,
          u_owner.phone       AS owner_phone,
          u_vet.name          AS vet_name,
          u_vet.phone         AS vet_phone,
          p.name              AS pet_name
        FROM appointments a
        JOIN users u_owner ON u_owner.user_id = a.owner_id
        JOIN users u_vet   ON u_vet.user_id   = a.vet_id
        JOIN pets  p       ON p.pet_id        = a.pet_id
        WHERE a.status = 'confirmed'
          AND a.appt_date >= CURRENT_DATE
        ORDER BY a.appt_date, a.appt_time
      `);

      for (const appt of rows) {
        const apptDateTime = new Date(`${appt.appt_date}T${appt.appt_time}`);
        const hoursUntil = (apptDateTime - Date.now()) / 36e5;

        // Only remind if appointment is within the next 48 hours but hasn't passed
        if (hoursUntil > 0 && hoursUntil <= 48) {
          await wa.sendAppointmentReminder({
            ownerPhone:  appt.owner_phone,
            vetName:     appt.vet_name,
            petName:     appt.pet_name,
            apptDate:    appt.appt_date,
            apptTime:    appt.appt_time,
            consultType: appt.consult_type,
            hoursUntil
          });
        }
      }
      console.log(`[CRON] Appointment reminders sent for ${rows.length} upcoming appointments`);
    } catch (err) {
      console.error('[CRON] Appointment reminder error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });
}

/* ═══════════════════════════════════════════════════════════════════════
   CRON 2 — Vaccination Reminders  (every 24 hours at 9 AM IST)
   Sends when: 30 days, 7 days, 3 days, 1 day before due, and when overdue
   ═══════════════════════════════════════════════════════════════════════ */
function scheduleVaccinationReminders() {
  // '30 3 * * *'  =  9:00 AM IST (UTC+5:30)
  cron.schedule('30 3 * * *', async () => {
    console.log('[CRON] Running vaccination reminder job...');
    try {
      // Fetch all upcoming / overdue vaccinations for pets with owner phones
      const { rows } = await query(`
        SELECT
          vr.vaccine_reminder_id,
          vr.vaccine_name,
          vr.due_date,
          vr.last_reminded_at,
          CURRENT_DATE - vr.due_date::date   AS days_overdue,
          vr.due_date::date - CURRENT_DATE   AS days_until_due,
          u.name                             AS owner_name,
          u.phone                            AS owner_phone,
          p.name                             AS pet_name,
          u_vet.name                         AS vet_name
        FROM vaccine_reminders vr
        JOIN pets  p     ON p.pet_id    = vr.pet_id
        JOIN users u     ON u.user_id   = p.owner_id
        LEFT JOIN users u_vet ON u_vet.user_id = vr.assigned_vet_id
        WHERE vr.status != 'completed'
          AND (
            (vr.due_date::date - CURRENT_DATE) IN (30, 7, 3, 1, 0)
            OR vr.due_date::date < CURRENT_DATE   -- overdue, remind daily
          )
          AND (
            vr.last_reminded_at IS NULL
            OR vr.last_reminded_at::date < CURRENT_DATE   -- not already sent today
          )
      `);

      for (const vac of rows) {
        const daysUntil = -parseInt(vac.days_overdue || 0) || parseInt(vac.days_until_due || 0);
        await wa.sendVaccinationReminder({
          ownerPhone:   vac.owner_phone,
          ownerName:    vac.owner_name,
          petName:      vac.pet_name,
          vaccineName:  vac.vaccine_name,
          dueDate:      vac.due_date,
          daysUntilDue: daysUntil,
          vetName:      vac.vet_name,
        });

        // Update last_reminded_at so we don't double-send today
        await query(
          `UPDATE vaccine_reminders SET last_reminded_at = NOW() WHERE vaccine_reminder_id = $1`,
          [vac.vaccine_reminder_id]
        );
      }
      console.log(`[CRON] Vaccination reminders sent for ${rows.length} pets`);
    } catch (err) {
      console.error('[CRON] Vaccination reminder error:', err.message);
    }
  }, { timezone: 'Asia/Kolkata' });
}

/** Call this once in server.js / app.js on startup */
function startCrons() {
  scheduleAppointmentReminders();
  scheduleVaccinationReminders();
  console.log('[CRON] WhatsApp cron jobs started ✅');
}

module.exports = { startCrons };
