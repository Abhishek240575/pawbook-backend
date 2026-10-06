// routes/appointments.js — Vet Appointment Booking
const express = require('express');
const router  = express.Router();
const { pool } = require('../config/db');
const { authenticate } = require('../middleware');
const { v4: uuidv4 } = require('uuid');

// POST /api/appointments — book a new appointment
router.post('/', authenticate, async (req, res) => {
  const {
    pet_id, vet_name, vet_spec, vet_img,
    consult_type, appt_date, appt_time, reason, fee
  } = req.body;

  if (!vet_name || !appt_date || !appt_time) {
    return res.status(400).json({ error: 'vet_name, appt_date, appt_time are required' });
  }

  const booking_id = 'BK' + uuidv4().replace(/-/g,'').slice(0,10).toUpperCase();

  try {
    const { rows } = await pool.query(
      `INSERT INTO appointments
         (booking_id, user_id, pet_id, vet_name, vet_spec, vet_img,
          consult_type, appt_date, appt_time, reason, fee)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       RETURNING *`,
      [booking_id, req.user.id, pet_id || null, vet_name, vet_spec || null,
       vet_img || null, consult_type || 'video', appt_date, appt_time,
       reason || null, fee || 0]
    );
    res.status(201).json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to book appointment' });
  }
});

// GET /api/appointments/mine — list all appointments for current user
router.get('/mine', authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT a.*, p.name AS pet_name
       FROM appointments a
       LEFT JOIN pets p ON a.pet_id = p.id
       WHERE a.user_id = $1
       ORDER BY a.appt_date DESC, a.appt_time DESC`,
      [req.user.id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load appointments' });
  }
});

// PATCH /api/appointments/:id/reschedule — change date/time
router.patch('/:id/reschedule', authenticate, async (req, res) => {
  const { appt_date, appt_time } = req.body;
  if (!appt_date || !appt_time) {
    return res.status(400).json({ error: 'appt_date and appt_time required' });
  }

  try {
    const { rows } = await pool.query(
      `UPDATE appointments
       SET appt_date=$1, appt_time=$2, status='rescheduled', updated_at=NOW()
       WHERE id=$3 AND user_id=$4
       RETURNING *`,
      [appt_date, appt_time, req.params.id, req.user.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'Appointment not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reschedule' });
  }
});

// DELETE /api/appointments/:id — cancel with refund calculation
router.delete('/:id', authenticate, async (req, res) => {
  const { cancel_reason } = req.body || {};

  try {
    // Fetch the appointment first
    const { rows: existing } = await pool.query(
      `SELECT * FROM appointments WHERE id=$1 AND user_id=$2`,
      [req.params.id, req.user.id]
    );
    if (!existing.length) return res.status(404).json({ error: 'Appointment not found' });

    const appt = existing[0];
    const apptDateTime = new Date(`${appt.appt_date}T${appt.appt_time}`);
    const hoursToAppt  = (apptDateTime - Date.now()) / 3600000;

    let refund_pct   = 0;
    let refund_status = 'none';
    if (hoursToAppt >= 24) { refund_pct = 100; refund_status = 'pending'; }
    else if (hoursToAppt >= 6) { refund_pct = 50; refund_status = 'pending'; }

    const refund_amount = Math.round((appt.fee * refund_pct) / 100);

    const { rows } = await pool.query(
      `UPDATE appointments
       SET status='cancelled', cancel_reason=$1,
           refund_status=$2, refund_amount=$3, updated_at=NOW()
       WHERE id=$4 AND user_id=$5
       RETURNING *`,
      [cancel_reason || null, refund_status, refund_amount,
       req.params.id, req.user.id]
    );

    res.json({
      appointment: rows[0],
      refund_pct,
      refund_amount,
      message: refund_pct > 0
        ? `Refund of ₹${refund_amount} will be processed in 5–7 business days`
        : 'No refund applicable (cancelled within 6 hours)'
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to cancel appointment' });
  }
});

module.exports = router;
