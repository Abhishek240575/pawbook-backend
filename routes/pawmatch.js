// routes/pawmatch.js — PawMatch Swipe & Matches
// "Pet" table (Prisma PascalCase): id, "userId" UUID, name, photos, ...
// users: user_id UUID, username, avatar_url
// notifications cols: user_id, type, title, body, link_url, is_read
const express = require('express');
const router  = express.Router();
const { pool } = require('../db');
const auth    = require('../middleware/auth');

// GET /api/pawmatch/discover?pet_id=X
router.get('/discover', auth, async (req, res) => {
  const { pet_id } = req.query;
  if (!pet_id) return res.status(400).json({ error: 'pet_id required' });

  try {
    // Verify the pet belongs to the user
    const { rows: myPets } = await pool.query(
      `SELECT id FROM "Pet" WHERE id=$1 AND "userId"=$2`,
      [pet_id, req.user.id]
    );
    if (!myPets.length) return res.status(403).json({ error: 'Not your pet' });

    const { rows } = await pool.query(
      `SELECT p.*, u.username AS owner_name, u.avatar_url AS owner_avatar
       FROM "Pet" p
       JOIN users u ON u.user_id = p."userId"
       WHERE p."userId" != $1
         AND p.id NOT IN (
           SELECT swiped_pet_id FROM pawmatch_swipes WHERE swiper_pet_id = $2
         )
       ORDER BY p.created_at DESC
       LIMIT 50`,
      [req.user.id, pet_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load discover feed' });
  }
});

// POST /api/pawmatch/swipe — record a swipe; returns match if mutual
router.post('/swipe', auth, async (req, res) => {
  const { swiper_pet_id, swiped_pet_id, direction } = req.body;
  if (!swiper_pet_id || !swiped_pet_id || !direction) {
    return res.status(400).json({ error: 'swiper_pet_id, swiped_pet_id, direction required' });
  }
  if (!['left','right','super'].includes(direction)) {
    return res.status(400).json({ error: 'direction must be left|right|super' });
  }

  try {
    // Verify pet ownership
    const { rows: myPets } = await pool.query(
      `SELECT id FROM "Pet" WHERE id=$1 AND "userId"=$2`,
      [swiper_pet_id, req.user.id]
    );
    if (!myPets.length) return res.status(403).json({ error: 'Not your pet' });

    // Upsert swipe
    await pool.query(
      `INSERT INTO pawmatch_swipes (swiper_pet_id, swiped_pet_id, direction)
       VALUES ($1,$2,$3)
       ON CONFLICT (swiper_pet_id, swiped_pet_id) DO UPDATE SET direction=$3`,
      [swiper_pet_id, swiped_pet_id, direction]
    );

    let matched = false;
    let match   = null;

    if (direction === 'right' || direction === 'super') {
      const { rows: mutual } = await pool.query(
        `SELECT id FROM pawmatch_swipes
         WHERE swiper_pet_id=$1 AND swiped_pet_id=$2
           AND direction IN ('right','super')`,
        [swiped_pet_id, swiper_pet_id]
      );

      if (mutual.length) {
        const { rows: matchRows } = await pool.query(
          `INSERT INTO pawmatch_matches (pet_a_id, pet_b_id)
           VALUES (LEAST($1,$2), GREATEST($1,$2))
           ON CONFLICT DO NOTHING
           RETURNING *`,
          [swiper_pet_id, swiped_pet_id]
        );
        matched = true;
        match   = matchRows[0] || null;

        if (match) {
          const { rows: otherPet } = await pool.query(
            `SELECT "userId", name FROM "Pet" WHERE id=$1`,
            [swiped_pet_id]
          );
          const { rows: myPetRow } = await pool.query(
            `SELECT name FROM "Pet" WHERE id=$1`,
            [swiper_pet_id]
          );
          if (otherPet.length && myPetRow.length) {
            const body = `${myPetRow[0].name} and ${otherPet[0].name} are a match!`;
            // Notify the other pet's owner
            await pool.query(
              `INSERT INTO notifications (user_id, type, title, body)
               VALUES ($1,'match','New PawMatch! 🐾',$2)`,
              [otherPet[0].userId, body]
            ).catch(() => {});
            // Notify current user
            await pool.query(
              `INSERT INTO notifications (user_id, type, title, body)
               VALUES ($1,'match','New PawMatch! 🐾',$2)`,
              [req.user.id, body]
            ).catch(() => {});
          }
        }
      }
    }

    res.json({ recorded: true, matched, match });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to record swipe' });
  }
});

// GET /api/pawmatch/matches?pet_id=X
router.get('/matches', auth, async (req, res) => {
  const { pet_id } = req.query;
  if (!pet_id) return res.status(400).json({ error: 'pet_id required' });

  try {
    const { rows } = await pool.query(
      `SELECT m.*,
              pa.name AS pet_a_name, pa.photos AS pet_a_photos,
              pb.name AS pet_b_name, pb.photos AS pet_b_photos,
              ua.username AS owner_a_name, ub.username AS owner_b_name
       FROM pawmatch_matches m
       JOIN "Pet" pa ON m.pet_a_id = pa.id
       JOIN "Pet" pb ON m.pet_b_id = pb.id
       JOIN users ua ON pa."userId" = ua.user_id
       JOIN users ub ON pb."userId" = ub.user_id
       WHERE m.pet_a_id=$1 OR m.pet_b_id=$1
       ORDER BY m.matched_at DESC`,
      [pet_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load matches' });
  }
});

module.exports = router;
