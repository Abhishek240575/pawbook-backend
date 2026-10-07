const pool = require('../db');
const R = require('../utils/response');

// GET /events — list all active events
async function getEvents(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT e.*, u.full_name as organizer_name, u.avatar_url as organizer_avatar,
        (SELECT COUNT(*) FROM event_attendees WHERE event_id=e.event_id AND status='going') as going_count,
        (SELECT COUNT(*) FROM event_attendees WHERE event_id=e.event_id AND status='interested') as interested_count
       FROM events e
       JOIN users u ON e.user_id=u.user_id
       WHERE e.status='active'
       ORDER BY e.event_date ASC`
    );
    return R.ok(res, rows);
  } catch(err) { return R.serverError(res, err.message); }
}

// GET /events/:id
async function getEvent(req, res) {
  try {
    const { rows } = await pool.query(
      `SELECT e.*, u.full_name as organizer_name,
        (SELECT COUNT(*) FROM event_attendees WHERE event_id=e.event_id AND status='going') as going_count,
        (SELECT COUNT(*) FROM event_attendees WHERE event_id=e.event_id AND status='interested') as interested_count
       FROM events e JOIN users u ON e.user_id=u.user_id
       WHERE e.event_id=$1 AND e.status='active'`,
      [req.params.id]
    );
    if(!rows.length) return R.notFound(res, 'Event not found');
    return R.ok(res, rows[0]);
  } catch(err) { return R.serverError(res, err.message); }
}

// POST /events — create event
async function createEvent(req, res) {
  try {
    const { title, description, event_date, location, event_type, cover_image, max_attendees, entry_fee } = req.body;
    if(!title || !event_date || !location) return R.badRequest(res, 'title, event_date and location are required');
    const { rows } = await pool.query(
      `INSERT INTO events (user_id,title,description,event_date,location,event_type,cover_image,max_attendees,entry_fee)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [req.user.user_id, title, description, event_date, location, event_type||'meetup', cover_image||null, max_attendees||null, entry_fee||null]
    );
    return R.created(res, rows[0], 'Event created');
  } catch(err) { return R.serverError(res, err.message); }
}

// POST /events/:id/rsvp — going / interested / none
async function rsvpEvent(req, res) {
  try {
    const { status } = req.body; // 'going' | 'interested' | 'none'
    const { id } = req.params;
    if(status === 'none') {
      await pool.query(`DELETE FROM event_attendees WHERE event_id=$1 AND user_id=$2`, [id, req.user.user_id]);
      return R.ok(res, null, 'RSVP removed');
    }
    await pool.query(
      `INSERT INTO event_attendees (event_id,user_id,status) VALUES ($1,$2,$3)
       ON CONFLICT (event_id,user_id) DO UPDATE SET status=$3`,
      [id, req.user.user_id, status]
    );
    return R.ok(res, { status }, 'RSVP saved');
  } catch(err) { return R.serverError(res, err.message); }
}

// DELETE /events/:id
async function deleteEvent(req, res) {
  try {
    const { rows } = await pool.query(`SELECT user_id FROM events WHERE event_id=$1`, [req.params.id]);
    if(!rows.length) return R.notFound(res, 'Event not found');
    if(rows[0].user_id !== req.user.user_id) return R.forbidden(res, 'Not your event');
    await pool.query(`UPDATE events SET status='deleted' WHERE event_id=$1`, [req.params.id]);
    return R.noContent(res);
  } catch(err) { return R.serverError(res, err.message); }
}

module.exports = { getEvents, getEvent, createEvent, rsvpEvent, deleteEvent };