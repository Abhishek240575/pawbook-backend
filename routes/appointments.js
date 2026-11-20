// routes/appointments.js
const express = require('express');
const router  = express.Router();
const { query } = require('../config/db');
const { authenticate } = require('../middleware');
const { v4: uuidv4 } = require('uuid');

async function getUserNo(userUuid) {
  const { rows } = await query(`SELECT user_no FROM users WHERE user_id=$1`, [userUuid]);
  return rows.length ? rows[0].user_no : null;
}

// Normalize consult_type to lowercase_underscore for DB constraint
function normalizeConsultType(val) {
  if (!val) return 'video';
  const map = {
    'video': 'video', 'Video': 'video', 'VIDEO': 'video',
    'chat': 'chat', 'Chat': 'chat', 'CHAT': 'chat',
    'in_clinic': 'in_clinic', 'in-clinic': 'in_clinic',
    'In-Clinic': 'in_clinic', 'IN-CLINIC': 'in_clinic',
    'in clinic': 'in_clinic', 'In Clinic': 'in_clinic',
  };
  return map[val] || val.toLowerCase().replace(/[-\s]/g, '_');
}

// POST /api/appointments
router.post('/', authenticate, async (req, res) => {
  const { pet_id, vet_id, vet_name, vet_spec, vet_img, consult_type, appt_date, appt_time, reason, fee } = req.body;

  // Support both vet_id-based (new frontend) and vet_name-based (legacy) bookings
  if (!appt_date || !appt_time) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: [{ msg: 'appt_date and appt_time are required' }] });
  }
  if (!vet_id && !vet_name) {
    return res.status(400).json({ success: false, message: 'Validation failed', errors: [{ msg: 'vet_id or vet_name is required' }] });
  }

  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });

    const normalizedConsultType = normalizeConsultType(consult_type);
    const booking_id = 'BK' + uuidv4().replace(/-/g,'').slice(0,10).toUpperCase();

    // If vet_id provided, look up vet details from vets table
    let resolvedVetName = vet_name || null;
    let resolvedVetSpec = vet_spec || null;
    let resolvedVetImg = vet_img || null;
    if (vet_id) {
      try {
        const { rows: vetRows } = await query(
          `SELECT name, specialization, profile_image FROM vets WHERE vet_id=$1`,
          [vet_id]
        );
        if (vetRows.length) {
          resolvedVetName = vetRows[0].name || resolvedVetName;
          resolvedVetSpec = vetRows[0].specialization || resolvedVetSpec;
          resolvedVetImg  = vetRows[0].profile_image || resolvedVetImg;
        }
      } catch (e) { /* vet lookup optional — proceed with provided values */ }
    }

    const { rows } = await query(
      `INSERT INTO vet_appointments
         (booking_id, user_id, pet_id, vet_id, vet_name, vet_spec, vet_img,
          consult_type, appt_date, appt_time, reason, fee)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING *`,
      [booking_id, userNo, pet_id || null, vet_id || null,
       resolvedVetName, resolvedVetSpec, resolvedVetImg,
       normalizedConsultType, appt_date, appt_time,
       reason || null, fee || 0]
    );
    res.status(201).json({ success: true, ...rows[0] });
  } catch (err) {
    console.error('[Appointments] POST error:', err.message);
    res.status(500).json({ success: false, message: err.message || 'Failed to book appointment' });
  }
});

// GET /api/appointments  (also handles /api/appointments/mine via query param or alias)
router.get('/', authenticate, async (req, res) => {
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });

    const { rows } = await query(
      `SELECT a.*, p.name AS pet_name
       FROM vet_appointments a
       LEFT JOIN pets p ON a.pet_id = p.id
       WHERE a.user_id = $1
       ORDER BY a.appt_date DESC, a.appt_time DESC`,
      [userNo]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load appointments' });
  }
});

// GET /api/appointments/mine
router.get('/mine', authenticate, async (req, res) => {
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });

    const { rows } = await query(
      `SELECT a.*, p.name AS pet_name
       FROM vet_appointments a
       LEFT JOIN pets p ON a.pet_id = p.id
       WHERE a.user_id = $1
       ORDER BY a.appt_date DESC, a.appt_time DESC`,
      [userNo]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load appointments' });
  }
});

// PATCH /api/appointments/:id/reschedule
router.patch('/:id/reschedule', authenticate, async (req, res) => {
  const { appt_date, appt_time } = req.body;
  if (!appt_date || !appt_time) return res.status(400).json({ error: 'appt_date and appt_time required' });
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });

    const { rows } = await query(
      `UPDATE vet_appointments SET appt_date=$1, appt_time=$2, status='rescheduled', updated_at=NOW()
       WHERE id=$3 AND user_id=$4 RETURNING *`,
      [appt_date, appt_time, req.params.id, userNo]
    );
    if (!rows.length) return res.status(404).json({ error: 'Appointment not found' });
    res.json(rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to reschedule' });
  }
});

// DELETE /api/appointments/:id
router.delete('/:id', authenticate, async (req, res) => {
  const { cancel_reason } = req.body || {};
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });

    const { rows: existing } = await query(
      `SELECT * FROM vet_appointments WHERE id=$1 AND user_id=$2`,
      [req.params.id, userNo]
    );
    if (!existing.length) return res.status(404).json({ error: 'Appointment not found' });

    const appt = existing[0];
    const apptDateTime = new Date(`${appt.appt_date}T${appt.appt_time}`);
    const hoursToAppt  = (apptDateTime - Date.now()) / 3600000;
    let refund_pct = 0, refund_status = 'none';
    if (hoursToAppt >= 24) { refund_pct = 100; refund_status = 'pending'; }
    else if (hoursToAppt >= 6) { refund_pct = 50; refund_status = 'pending'; }
    const refund_amount = Math.round((appt.fee * refund_pct) / 100);

    const { rows } = await query(
      `UPDATE vet_appointments SET status='cancelled', cancel_reason=$1,
          refund_status=$2, refund_amount=$3, updated_at=NOW()
       WHERE id=$4 AND user_id=$5 RETURNING *`,
      [cancel_reason || null, refund_status, refund_amount, req.params.id, userNo]
    );
    res.json({ appointment: rows[0], refund_pct, refund_amount,
      message: refund_pct > 0 ? `Refund of ${refund_amount} will be processed in 5-7 business days` : 'No refund applicable' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to cancel appointment' });
  }
});

module.exports = router;
