// routes/pawmatch.js
const express = require('express');
const router  = express.Router();
const { query } = require('../config/db');
const { authenticate } = require('../middleware');

async function getUserNo(userUuid) {
  const { rows } = await query(`SELECT user_no FROM users WHERE user_id=$1`, [userUuid]);
  return rows.length ? rows[0].user_no : null;
}

router.get('/discover', authenticate, async (req, res) => {
  const { pet_id } = req.query;
  if (!pet_id) return res.status(400).json({ error: 'pet_id required' });
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });

    const { rows: myPets } = await query(`SELECT id FROM pets WHERE id=$1 AND user_id=$2`, [pet_id, userNo]);
    if (!myPets.length) return res.status(403).json({ error: 'Not your pet' });

    const { rows } = await query(
      `SELECT p.*, u.username AS owner_name, u.avatar_url AS owner_avatar
       FROM pets p
       JOIN users u ON p.user_id = u.user_no
       WHERE p.user_id != $1
         AND p.id NOT IN (SELECT swiped_pet_id FROM pawmatch_swipes WHERE swiper_pet_id = $2)
       ORDER BY p.created_at DESC LIMIT 50`,
      [userNo, pet_id]
    );
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to load discover feed' });
  }
});

router.post('/swipe', authenticate, async (req, res) => {
  const { swiper_pet_id, swiped_pet_id, direction } = req.body;
  if (!swiper_pet_id || !swiped_pet_id || !direction) {
    return res.status(400).json({ error: 'swiper_pet_id, swiped_pet_id, direction required' });
  }
  if (!['left','right','super'].includes(direction)) {
    return res.status(400).json({ error: 'direction must be left|right|super' });
  }
  try {
    const userNo = await getUserNo(req.user.user_id);
    if (!userNo) return res.status(401).json({ error: 'User not found' });

    const { rows: myPets } = await query(`SELECT id FROM pets WHERE id=$1 AND user_id=$2`, [swiper_pet_id, userNo]);
    if (!myPets.length) return res.status(403).json({ error: 'Not your pet' });

    await query(
      `INSERT INTO pawmatch_swipes (swiper_pet_id, swiped_pet_id, direction) VALUES ($1,$2,$3)
       ON CONFLICT (swiper_pet_id, swiped_pet_id) DO UPDATE SET direction=$3`,
      [swiper_pet_id, swiped_pet_id, direction]
    );

    let matched = false, match = null;
    if (direction === 'right' || direction === 'super') {
      const { rows: mutual } = await query(
        `SELECT id FROM pawmatch_swipes WHERE swiper_pet_id=$1 AND swiped_pet_id=$2 AND direction IN ('right','super')`,
        [swiped_pet_id, swiper_pet_id]
      );
      if (mutual.length) {
        const { rows: matchRows } = await query(
          `INSERT INTO pawmatch_matches (pet_a_id, pet_b_id)
           VALUES (LEAST($1,$2), GREATEST($1,$2))
           ON CONFLICT DO NOTHING RETURNING *`,
          [swiper_pet_id, swiped_pet_id]
        );
        matched = true;
        match = matchRows[0] || null;
        if (match) {
          const { rows: otherPet } = await query(`SELECT user_id, name FROM pets WHERE id=$1`, [swiped_pet_id]);
          const { rows: myPetRow } = await query(`SELECT name FROM pets WHERE id=$1`, [swiper_pet_id]);
          if (otherPet.length && myPetRow.length) {
            // get UUIDs for notification recipient_id
            const { rows: ownerA } = await query(`SELECT user_id FROM users WHERE user_no=$1`, [otherPet[0].user_id]);
            if (ownerA.length) {
              await query(
                `INSERT INTO notifications (recipient_id, type, title, message, ref_type, ref_id)
                 VALUES ($1,'match','New PawMatch!',$2,'pet',$3)`,
                [ownerA[0].user_id, `${myPetRow[0].name} and ${otherPet[0].name} are a match!`, match.id]
              ).catch(() => {});
            }
            await query(
              `INSERT INTO notifications (recipient_id, type, title, message, ref_type, ref_id)
               VALUES ($1,'match','New PawMatch!',$2,'pet',$3)`,
              [req.user.user_id, `${myPetRow[0].name} and ${otherPet[0].name} are a match!`, match.id]
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

router.get('/matches', authenticate, async (req, res) => {
  const { pet_id } = req.query;
  if (!pet_id) return res.status(400).json({ error: 'pet_id required' });
  try {
    const { rows } = await query(
      `SELECT m.*,
              pa.name AS pet_a_name, pa.photos AS pet_a_photos,
              pb.name AS pet_b_name, pb.photos AS pet_b_photos,
              ua.username AS owner_a_name, ub.username AS owner_b_name
       FROM pawmatch_matches m
       JOIN pets pa ON m.pet_a_id = pa.id
       JOIN pets pb ON m.pet_b_id = pb.id
       JOIN users ua ON pa.user_id = ua.user_no
       JOIN users ub ON pb.user_id = ub.user_no
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
