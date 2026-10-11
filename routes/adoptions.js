// ═══════════════════════════════════════════════════════════════
//  PawBook — Adoption Lifecycle Routes  (v2 — UUID schema)
//  File: routes/adoptions.js
//  Replace your existing adoptions.js with this file
//
//  Schema reality:
//    shelters.shelter_id          UUID (PK)
//    adoption_inquiries.inquiry_id UUID (PK)
//    adoptable_pets.id            INT  (PK)
//    adoptable_pets.shelter_id    UUID (FK → shelters.shelter_id)
//    adoption_inquiries.shelter_id UUID (FK → shelters.shelter_id)
// ═══════════════════════════════════════════════════════════════
const express  = require('express');
const router   = express.Router();
const { pool } = require('../db');
const nodemailer = require('nodemailer'); // npm install nodemailer

// ── Email transporter ────────────────────────────────────────
// Add to Render env vars:
//   SMTP_HOST=smtp.gmail.com  SMTP_PORT=587
//   SMTP_USER=your@gmail.com  SMTP_PASS=your_app_password
//   SMTP_FROM=PawBook <noreply@pawbook.app>
function getMailer() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}
async function sendMail(to, subject, html) {
  try {
    if (!process.env.SMTP_USER) return;
    await getMailer().sendMail({
      from: process.env.SMTP_FROM || 'PawBook <noreply@pawbook.app>',
      to, subject, html
    });
  } catch(e) { console.error('Mail error:', e.message); }
}

// ── Auth middleware ──────────────────────────────────────────
function optionalAuth(req, res, next) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) {
    try {
      const jwt = require('jsonwebtoken');
      req.user = jwt.verify(h.slice(7), process.env.JWT_SECRET);
    } catch(_) {}
  }
  next();
}
function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer '))
    return res.status(401).json({ success:false, message:'Login required' });
  try {
    const jwt = require('jsonwebtoken');
    req.user = jwt.verify(h.slice(7), process.env.JWT_SECRET);
    next();
  } catch(_) {
    return res.status(401).json({ success:false, message:'Invalid token' });
  }
}

// ═══════════════════════════════════════════════════════════════
//  GET /api/v1/adoptions/shelters
//  Shelters with pet counts by species, filtered by location
// ═══════════════════════════════════════════════════════════════
router.get('/shelters', async (req, res) => {
  try {
    const { city, state, country } = req.query;
    const conditions = ['1=1'];
    const vals = [];
    if (country) { vals.push(country); conditions.push(`s.country ILIKE $${vals.length}`); }
    if (state)   { vals.push(state);   conditions.push(`s.state   ILIKE $${vals.length}`); }
    if (city)    { vals.push(city);    conditions.push(`s.city    ILIKE $${vals.length}`); }

    const q = `
      SELECT
        s.shelter_id AS id,
        s.name, s.city, s.state, s.country,
        s.address, s.phone, s.contact_email, s.contact_phone,
        s.website, s.capacity, s.animals_accepted,
        s.is_verified, s.rating, s.adoptions_this_month,
        COUNT(p.id)                                          AS total_pets,
        COUNT(p.id) FILTER (WHERE p.status='available')      AS available_count,
        COUNT(p.id) FILTER (WHERE p.status='urgent')         AS urgent_count,
        COUNT(p.id) FILTER (WHERE p.species ILIKE 'dog'
                              AND p.status != 'adopted')     AS dog_count,
        COUNT(p.id) FILTER (WHERE p.species ILIKE 'cat'
                              AND p.status != 'adopted')     AS cat_count,
        COUNT(p.id) FILTER (WHERE p.species NOT ILIKE 'dog'
                             AND p.species NOT ILIKE 'cat'
                             AND p.status != 'adopted')      AS other_count
      FROM shelters s
      LEFT JOIN adoptable_pets p ON p.shelter_id = s.shelter_id
      WHERE ${conditions.join(' AND ')}
      GROUP BY s.shelter_id
      ORDER BY available_count DESC, s.name
    `;
    const { rows } = await pool.query(q, vals);
    res.json({ success:true, message:'Success', data: rows });
  } catch(e) {
    console.error(e);
    res.status(500).json({ success:false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  GET /api/v1/adoptions/shelters/:id/pets
//  Available/urgent pets in a specific shelter
// ═══════════════════════════════════════════════════════════════
router.get('/shelters/:id/pets', async (req, res) => {
  try {
    const { id } = req.params;          // UUID
    const { species } = req.query;
    const vals = [id];
    let speciesClause = '';
    if (species && species !== 'all') {
      vals.push(`%${species}%`);
      speciesClause = `AND p.species ILIKE $${vals.length}`;
    }

    const q = `
      SELECT
        p.*,
        s.name AS shelter_name,
        s.city AS shelter_city,
        s.contact_email AS shelter_email
      FROM adoptable_pets p
      JOIN shelters s ON s.shelter_id = p.shelter_id
      WHERE p.shelter_id = $1::uuid
        AND p.status != 'adopted'
        ${speciesClause}
      ORDER BY
        CASE WHEN p.status='urgent' THEN 0 ELSE 1 END,
        p.created_at DESC
    `;
    const { rows } = await pool.query(q, vals);
    res.json({ success:true, message:'Success', data: rows });
  } catch(e) {
    console.error(e);
    res.status(500).json({ success:false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  GET /api/v1/adoptions/pets
//  Available pets with filters (excludes adopted)
// ═══════════════════════════════════════════════════════════════
router.get('/pets', async (req, res) => {
  try {
    const { species, city, urgency, search, limit=9, offset=0 } = req.query;
    const conditions = ["p.status != 'adopted'"];
    const vals = [];
    if (species && species !== 'all') { vals.push(`%${species}%`); conditions.push(`p.species ILIKE $${vals.length}`); }
    if (city)    { vals.push(`%${city}%`);    conditions.push(`(p.location_city ILIKE $${vals.length} OR s.city ILIKE $${vals.length})`); }
    if (urgency) { conditions.push(`p.status='urgent'`); }
    if (search)  { vals.push(`%${search}%`);  conditions.push(`p.name ILIKE $${vals.length}`); }

    const where = conditions.join(' AND ');
    const countQ = `
      SELECT COUNT(*) FROM adoptable_pets p
      LEFT JOIN shelters s ON s.shelter_id = p.shelter_id
      WHERE ${where}`;
    const dataQ = `
      SELECT p.*, s.name AS shelter_name, s.city AS shelter_city
      FROM adoptable_pets p
      LEFT JOIN shelters s ON s.shelter_id = p.shelter_id
      WHERE ${where}
      ORDER BY CASE WHEN p.status='urgent' THEN 0 ELSE 1 END, p.created_at DESC
      LIMIT $${vals.length+1} OFFSET $${vals.length+2}`;

    const [countR, dataR] = await Promise.all([
      pool.query(countQ, vals),
      pool.query(dataQ, [...vals, limit, offset])
    ]);
    res.json({
      success:true, message:'Success',
      data:{ pets: dataR.rows, total: parseInt(countR.rows[0].count) }
    });
  } catch(e) {
    console.error(e);
    res.status(500).json({ success:false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  GET /api/v1/adoptions/pets/:id — single pet
// ═══════════════════════════════════════════════════════════════
router.get('/pets/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT p.*, s.name AS shelter_name, s.city AS shelter_city,
              s.address AS shelter_address, s.contact_email AS shelter_email,
              s.contact_phone AS shelter_phone, s.is_verified AS shelter_verified
       FROM adoptable_pets p
       LEFT JOIN shelters s ON s.shelter_id = p.shelter_id
       WHERE p.id = $1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success:false, message:'Pet not found' });
    res.json({ success:true, data: rows[0] });
  } catch(e) {
    res.status(500).json({ success:false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  GET /api/v1/adoptions/adopted — adopted pets (public)
// ═══════════════════════════════════════════════════════════════
router.get('/adopted', async (req, res) => {
  try {
    const { limit=12, offset=0 } = req.query;
    const { rows } = await pool.query(
      `SELECT p.id, p.name, p.species, p.breed, p.photo_url,
              p.adopted_by_name, p.adopted_at, p.adoption_doc_url, p.legal_site,
              s.name AS shelter_name, s.city AS shelter_city
       FROM adoptable_pets p
       LEFT JOIN shelters s ON s.shelter_id = p.shelter_id
       WHERE p.status = 'adopted'
       ORDER BY p.adopted_at DESC NULLS LAST
       LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ success:true, data: rows });
  } catch(e) {
    res.status(500).json({ success:false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  POST /api/v1/adoptions/inquire — submit adoption request
// ═══════════════════════════════════════════════════════════════
router.post('/inquire', optionalAuth, async (req, res) => {
  try {
    const {
      pet_id,
      applicant_name, applicant_email, applicant_phone,
      purpose, reason,
      living_situation, prior_pet_experience,
      has_cruelty_record, cruelty_details,
      has_complaints, complaint_details,
      declaration_accepted,
      message
    } = req.body;

    if (!pet_id || !applicant_name || !applicant_email || !declaration_accepted) {
      return res.status(400).json({ success:false, message:'Pet ID, name, email and declaration are required' });
    }

    // Get pet + shelter info
    const { rows: petRows } = await pool.query(
      `SELECT p.*, s.contact_email AS shelter_email, s.name AS shelter_name,
              s.shelter_id AS shelter_uuid
       FROM adoptable_pets p
       LEFT JOIN shelters s ON s.shelter_id = p.shelter_id
       WHERE p.id = $1 AND p.status != 'adopted'`, [pet_id]
    );
    if (!petRows.length) {
      return res.status(404).json({ success:false, message:'Pet not found or already adopted' });
    }
    const pet = petRows[0];

    // Check for duplicate pending inquiry
    const { rows: dupRows } = await pool.query(
      `SELECT inquiry_id FROM adoption_inquiries
       WHERE pet_id=$1 AND applicant_email=$2
         AND status IN ('pending','shelter_reviewing','visit_scheduled')`,
      [pet_id, applicant_email]
    );
    if (dupRows.length) {
      return res.status(409).json({ success:false, message:'You already have a pending inquiry for this pet' });
    }

    // Save inquiry (inquiry_id is UUID generated by DB default)
    const { rows: inqRows } = await pool.query(
      `INSERT INTO adoption_inquiries
         (pet_id, shelter_id, applicant_name, applicant_email, applicant_phone,
          purpose, reason, living_situation, prior_pet_experience,
          has_cruelty_record, cruelty_details, has_complaints, complaint_details,
          declaration_accepted, message, status, created_at, updated_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pending',NOW(),NOW())
       RETURNING inquiry_id`,
      [pet_id, pet.shelter_uuid||null,
       applicant_name, applicant_email, applicant_phone||null,
       purpose||null, reason||null, living_situation||null, prior_pet_experience||null,
       has_cruelty_record||false, cruelty_details||null,
       has_complaints||false, complaint_details||null,
       true, message||null]
    );
    const inquiryId = inqRows[0].inquiry_id;

    // Email shelter
    if (pet.shelter_email) {
      await sendMail(
        pet.shelter_email,
        `🐾 New Adoption Request — ${pet.name}`,
        `<div style="font-family:sans-serif;max-width:600px">
          <h2 style="color:#16a34a">New Adoption Inquiry</h2>
          <p><strong>Pet:</strong> ${pet.name} (${pet.species}${pet.breed ? ' · '+pet.breed : ''})</p>
          <p><strong>Inquiry ID:</strong> ${inquiryId}</p>
          <hr>
          <h3>Applicant Details</h3>
          <p><strong>Name:</strong> ${applicant_name}</p>
          <p><strong>Email:</strong> ${applicant_email}</p>
          <p><strong>Phone:</strong> ${applicant_phone||'Not provided'}</p>
          <h3>Declaration</h3>
          <p><strong>Purpose:</strong> ${purpose||'—'}</p>
          <p><strong>Reason:</strong> ${reason||'—'}</p>
          <p><strong>Living Situation:</strong> ${living_situation||'—'}</p>
          <p><strong>Prior Pet Experience:</strong> ${prior_pet_experience||'—'}</p>
          <p><strong>Cruelty Record:</strong> ${has_cruelty_record ? 'YES — '+cruelty_details : 'No'}</p>
          <p><strong>Complaints:</strong> ${has_complaints ? 'YES — '+complaint_details : 'No'}</p>
          <p><strong>Message:</strong> ${message||'—'}</p>
          <hr>
          <p style="color:#65676b;font-size:12px">Login to PawBook shelter portal to review and respond.</p>
        </div>`
      );
    }

    // Confirmation email to applicant
    await sendMail(
      applicant_email,
      `✅ Adoption Request Received — ${pet.name}`,
      `<div style="font-family:sans-serif;max-width:600px">
        <h2 style="color:#16a34a">Your Adoption Request is Submitted!</h2>
        <p>Dear ${applicant_name},</p>
        <p>We have received your adoption request for <strong>${pet.name}</strong>
           at <strong>${pet.shelter_name||'the shelter'}</strong>.</p>
        <p><strong>Request ID: ${inquiryId}</strong></p>
        <p>The shelter will review your application and verify your profile.
           If approved, they will contact you to schedule a visit.</p>
        <h3>What happens next?</h3>
        <ol>
          <li>Shelter reviews your declaration &amp; background check</li>
          <li>You receive an invitation to visit the shelter</li>
          <li>Adoption papers are signed and uploaded to the legal portal</li>
          <li>${pet.name} goes home with you! 🎉</li>
        </ol>
        <p style="color:#65676b;font-size:12px">PawBook — Every pet deserves a loving home.</p>
      </div>`
    );

    res.json({
      success:true,
      message:`Adoption request submitted! ${pet.shelter_name||'The shelter'} will review and contact you.`,
      data:{ inquiry_id: inquiryId, shelter_name: pet.shelter_name, pet_name: pet.name }
    });
  } catch(e) {
    console.error(e);
    res.status(500).json({ success:false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  PATCH /api/v1/adoptions/inquire/:id/status
//  Shelter updates inquiry status
//  Body: { status, shelter_notes, visit_date }
// ═══════════════════════════════════════════════════════════════
router.patch('/inquire/:id/status', requireAuth, async (req, res) => {
  try {
    const { id } = req.params;         // UUID (inquiry_id)
    const { status, shelter_notes, visit_date } = req.body;
    const validStatuses = ['pending','shelter_reviewing','visit_scheduled','rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success:false, message:'Invalid status' });
    }

    const { rows } = await pool.query(
      `UPDATE adoption_inquiries
       SET status=$1, shelter_notes=$2, visit_date=$3, updated_at=NOW()
       WHERE inquiry_id=$4::uuid
       RETURNING *`,
      [status, shelter_notes||null, visit_date||null, id]
    );
    if (!rows.length) return res.status(404).json({ success:false, message:'Inquiry not found' });
    const inq = rows[0];

    if (status === 'visit_scheduled' && inq.applicant_email) {
      await sendMail(
        inq.applicant_email,
        `🐾 Visit Scheduled — Adoption Request`,
        `<div style="font-family:sans-serif;max-width:600px">
          <h2 style="color:#16a34a">Your Visit is Scheduled!</h2>
          <p>Dear ${inq.applicant_name},</p>
          <p>The shelter has reviewed your adoption request and scheduled a visit.</p>
          <p><strong>Visit Date:</strong> ${visit_date ? new Date(visit_date).toLocaleDateString('en-IN',{dateStyle:'full'}) : 'TBD — shelter will confirm'}</p>
          <p><strong>Notes:</strong> ${shelter_notes||'Please arrive on time and bring a valid photo ID.'}</p>
          <p style="color:#65676b;font-size:12px">PawBook — Every pet deserves a loving home.</p>
        </div>`
      );
    }
    if (status === 'rejected' && inq.applicant_email) {
      await sendMail(
        inq.applicant_email,
        `Adoption Request Update`,
        `<div style="font-family:sans-serif;max-width:600px">
          <h2>Adoption Request Update</h2>
          <p>Dear ${inq.applicant_name},</p>
          <p>Unfortunately, we are unable to proceed with your adoption request at this time.</p>
          ${shelter_notes ? `<p><strong>Reason:</strong> ${shelter_notes}</p>` : ''}
          <p>You are welcome to apply again in the future. Thank you for caring about animals.</p>
        </div>`
      );
    }

    res.json({ success:true, message:`Inquiry updated to ${status}`, data: inq });
  } catch(e) {
    console.error(e);
    res.status(500).json({ success:false, message: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════
//  POST /api/v1/adoptions/complete/:inquiry_id
//  Mark adoption complete — pet → adopted, send certificate email
//  Body: { adopted_by_name, legal_doc_url, legal_site, verification_notes }
// ═══════════════════════════════════════════════════════════════
router.post('/complete/:inquiry_id', requireAuth, async (req, res) => {
  try {
    const { inquiry_id } = req.params;    // UUID
    const { adopted_by_name, legal_doc_url, legal_site, verification_notes } = req.body;

    // Get inquiry + pet + shelter
    const { rows: iqRows } = await pool.query(
      `SELECT i.*, p.name AS pet_name, p.species,
              s.name AS shelter_name, s.shelter_id AS shelter_uuid
       FROM adoption_inquiries i
       JOIN adoptable_pets p ON p.id = i.pet_id
       LEFT JOIN shelters s ON s.shelter_id = i.shelter_id
       WHERE i.inquiry_id = $1::uuid`, [inquiry_id]
    );
    if (!iqRows.length) return res.status(404).json({ success:false, message:'Inquiry not found' });
    const inq = iqRows[0];

    // Mark pet adopted
    await pool.query(
      `UPDATE adoptable_pets
       SET status='adopted',
           adopted_by_name=$1,
           adopted_at=NOW(),
           adoption_doc_url=$2,
           legal_site=$3
       WHERE id=$4`,
      [adopted_by_name||inq.applicant_name, legal_doc_url||null, legal_site||null, inq.pet_id]
    );

    // Mark inquiry adopted
    await pool.query(
      `UPDATE adoption_inquiries SET status='adopted', updated_at=NOW()
       WHERE inquiry_id=$1::uuid`, [inquiry_id]
    );

    // Log verification record
    await pool.query(
      `INSERT INTO adoption_verifications
         (inquiry_id, shelter_id, verified_by, verification_notes,
          legal_doc_url, legal_site, status, created_at)
       VALUES($1::uuid, $2::uuid, $3, $4, $5, $6, 'approved', NOW())`,
      [inquiry_id, inq.shelter_uuid,
       req.user?.name||'Shelter Staff',
       verification_notes||null, legal_doc_url||null, legal_site||null]
    );

    // Email new owner
    if (inq.applicant_email) {
      await sendMail(
        inq.applicant_email,
        `🎉 Congratulations! ${inq.pet_name} is now yours!`,
        `<div style="font-family:sans-serif;max-width:600px">
          <h2 style="color:#16a34a">🎉 Adoption Complete!</h2>
          <p>Dear ${inq.applicant_name},</p>
          <p>Congratulations! <strong>${inq.pet_name}</strong> has been officially adopted
             and is now part of your family. 🐾</p>
          ${legal_doc_url ? `<p><a href="${legal_doc_url}" style="color:#1877F2;font-weight:700">📄 View Your Adoption Certificate</a></p>` : ''}
          <p>Thank you for giving ${inq.pet_name} a loving forever home!</p>
          <p style="color:#65676b;font-size:12px">— ${inq.shelter_name||'The Shelter'} &amp; PawBook</p>
        </div>`
      );
    }

    res.json({
      success:true,
      message:`${inq.pet_name} has been successfully adopted by ${adopted_by_name||inq.applicant_name}!`
    });
  } catch(e) {
    console.error(e);
    res.status(500).json({ success:false, message: e.message });
  }
});

module.exports = router;
