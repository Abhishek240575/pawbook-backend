const { query } = require('../config/db');

async function listBusinesses(req, res) {
  try {
    const { city, category, lat, lng, radius = 50 } = req.query;
    let conditions = ["b.status = 'approved'"];
    const params = [];
    if (city) { params.push(`%${city.toLowerCase()}%`); conditions.push(`LOWER(b.city) LIKE $${params.length}`); }
    if (category && category !== 'all') { params.push(category); conditions.push(`b.category = $${params.length}`); }
    let distanceSelect = '';
    if (lat && lng) {
      const rlat = parseFloat(lat), rlng = parseFloat(lng);
      params.push(rlat); const pLat = params.length;
      params.push(rlng); const pLng = params.length;
      params.push(parseFloat(radius)); const pRad = params.length;
      distanceSelect = `, ROUND(111.045 * DEGREES(ACOS(LEAST(1.0, COS(RADIANS($${pLat})) * COS(RADIANS(b.lat)) * COS(RADIANS(b.lng) - RADIANS($${pLng})) + SIN(RADIANS($${pLat})) * SIN(RADIANS(b.lat))))), 2) AS distance_km`;
      conditions.push(`b.lat IS NOT NULL AND b.lng IS NOT NULL`);
      conditions.push(`111.045 * DEGREES(ACOS(LEAST(1.0, COS(RADIANS($${pLat})) * COS(RADIANS(b.lat)) * COS(RADIANS(b.lng) - RADIANS($${pLng})) + SIN(RADIANS($${pLat})) * SIN(RADIANS(b.lat))))) < $${pRad}`);
    }
    const where = conditions.length ? 'WHERE ' + conditions.join(' AND ') : '';
    const sql = `SELECT b.business_id, b.name, b.category, b.description, b.address, b.city, b.state, b.country, b.lat, b.lng, b.phone, b.email, b.website, b.opening_hours, b.services, b.accepts_walk_ins, b.emergency_24h, b.photo_url, b.verified, b.created_at ${distanceSelect} FROM pet_businesses b ${where} ORDER BY ${lat && lng ? 'distance_km ASC' : 'b.created_at DESC'} LIMIT 200`;
    const { rows } = await query(sql, params);
    res.json({ success: true, businesses: rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
}

async function registerBusiness(req, res) {
  try {
    const userId = req.user?.user_id || null;
    const { name, category, description, address, city, state, country, pincode, lat, lng, phone, email, website, opening_hours, services, accepts_walk_ins, emergency_24h, photo_url } = req.body;
    if (!name || !category || !address || !city || !country) return res.status(400).json({ success: false, message: 'name, category, address, city and country are required' });
    const validCats = ['vet','shelter','zoo','aquarium','breeding','grooming','petshop','emergency'];
    if (!validCats.includes(category)) return res.status(400).json({ success: false, message: 'Invalid category' });
    const { rows } = await query(
      `INSERT INTO pet_businesses (owner_id,name,category,description,address,city,state,country,pincode,lat,lng,phone,email,website,opening_hours,services,accepts_walk_ins,emergency_24h,photo_url,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'pending') RETURNING business_id, name, status`,
      [userId, name, category, description||null, address, city, state||null, country||'India', pincode||null, lat?parseFloat(lat):null, lng?parseFloat(lng):null, phone||null, email||null, website||null, opening_hours||null, services?(Array.isArray(services)?services:[services]):[], accepts_walk_ins!==false, emergency_24h===true, photo_url||null]
    );
    res.status(201).json({ success: true, message: 'Business registered! It will appear after review.', business: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
}

async function moderateBusiness(req, res) {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin only' });
    const { business_id } = req.params;
    const { action } = req.body;
    if (!['approve','reject'].includes(action)) return res.status(400).json({ success: false, message: 'action must be approve or reject' });
    const { rows } = await query(`UPDATE pet_businesses SET status=$1, verified=$2 WHERE business_id=$3 RETURNING business_id, name, status`, [action==='approve'?'approved':'rejected', action==='approve', business_id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Business not found' });
    res.json({ success: true, business: rows[0] });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
}

async function listPending(req, res) {
  try {
    if (req.user?.role !== 'admin') return res.status(403).json({ success: false, message: 'Admin only' });
    const { rows } = await query(`SELECT * FROM pet_businesses WHERE status='pending' ORDER BY created_at ASC LIMIT 100`);
    res.json({ success: true, businesses: rows });
  } catch (err) { res.status(500).json({ success: false, message: 'Server error' }); }
}

module.exports = { listBusinesses, registerBusiness, moderateBusiness, listPending };
