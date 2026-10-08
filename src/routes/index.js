const router = require('express').Router();
const { body, param, query } = require('express-validator');

const {
  authenticate, requireRole, requireVerified,
  validate, parsePagination
} = require('../middleware');

const authCtrl = require('../controllers/auth.controller');
const userCtrl = require('../controllers/user.controller');
const petCtrl  = require('../controllers/pet.controller');
const postCtrl = require('../controllers/post.controller');
const vetCtrl  = require('../controllers/vet.controller');

// ── AUTH ──────────────────────────────────────────────────────
const authRouter = require('express').Router();

authRouter.post('/register', [
  body('username').trim().isLength({ min:3, max:50 }).matches(/^[a-z0-9_.]+$/i),
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  body('full_name').trim().notEmpty(),
  body('role').optional().isIn(['pet_owner','vet','shelter_admin']),
], validate, authCtrl.register);

authRouter.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').notEmpty(),
], validate, authCtrl.login);

authRouter.post('/refresh', [
  body('refresh_token').notEmpty(),
], validate, authCtrl.refresh);

authRouter.get('/me',          authenticate, authCtrl.me);
authRouter.patch('/password',  authenticate, [
  body('current_password').notEmpty(),
  body('new_password').isLength({ min: 8 }),
], validate, authCtrl.changePassword);

router.use('/auth', authRouter);

// ── USERS ─────────────────────────────────────────────────────
const userRouter = require('express').Router();

userRouter.get('/search',             authenticate, parsePagination, userCtrl.searchUsers);
userRouter.get('/:username/profile',  userCtrl.getProfile);
userRouter.get('/:user_id/followers', authenticate, parsePagination, userCtrl.getFollowers);
userRouter.get('/:user_id/following', authenticate, parsePagination, userCtrl.getFollowing);
userRouter.get('/:user_id/posts',     authenticate, parsePagination, postCtrl.getUserPosts);

userRouter.patch('/me',               authenticate, userCtrl.updateProfile);
userRouter.patch('/me/preferences',   authenticate, userCtrl.updatePreferences);
userRouter.delete('/me',              authenticate, userCtrl.deactivate);

userRouter.post('/:user_id/follow',   authenticate, [
  param('user_id').isUUID(),
], validate, userCtrl.follow);

userRouter.post('/:user_id/block',    authenticate, [
  param('user_id').isUUID(),
], validate, userCtrl.block);

router.use('/users', userRouter);

// ── PETS ──────────────────────────────────────────────────────
const petRouter = require('express').Router();

petRouter.get('/my',                  authenticate, petCtrl.getMyPets);
petRouter.get('/vaccinations/due',    authenticate, petCtrl.getVaccinationsDue);
petRouter.get('/:pet_id',             petCtrl.getPet);
petRouter.get('/:pet_id/health',      authenticate, petCtrl.getHealthTimeline);

petRouter.post('/', authenticate, [
  body('name').trim().notEmpty(),
  body('species').trim().notEmpty(),
  body('gender').optional().isIn(['male','female','unknown']),
], validate, petCtrl.createPet);

petRouter.patch('/:pet_id', authenticate, [
  param('pet_id').isUUID(),
], validate, petCtrl.updatePet);

petRouter.delete('/:pet_id', authenticate, [
  param('pet_id').isUUID(),
], validate, petCtrl.deletePet);

petRouter.post('/:pet_id/vaccinations', authenticate, [
  param('pet_id').isUUID(),
  body('vaccine_name').trim().notEmpty(),
  body('administered_at').isDate(),
], validate, petCtrl.addVaccination);

router.use('/pets', petRouter);

// ── POSTS / FEED ──────────────────────────────────────────────
const postRouter = require('express').Router();

postRouter.get('/feed',               authenticate, parsePagination, postCtrl.getFeed);
postRouter.get('/:post_id',           postCtrl.getPost);
postRouter.get('/:post_id/comments',  parsePagination, postCtrl.getComments);

postRouter.post('/', authenticate, [
  body('body').optional().isLength({ max: 5000 }),
  body('visibility').optional().isIn(['public','followers','private','group']),
], validate, postCtrl.createPost);

postRouter.patch('/:post_id', authenticate, [
  param('post_id').isUUID(),
], validate, postCtrl.updatePost);

postRouter.delete('/:post_id', authenticate, [
  param('post_id').isUUID(),
], validate, postCtrl.deletePost);

postRouter.post('/:post_id/react', authenticate, [
  param('post_id').isUUID(),
  body('reaction_type').isIn(['love','haha','wow','sad','angry','care','paw']),
], validate, postCtrl.reactToPost);

postRouter.post('/:post_id/comments', authenticate, [
  param('post_id').isUUID(),
  body('body').trim().isLength({ min:1, max:2000 }),
], validate, postCtrl.addComment);

postRouter.delete('/comments/:comment_id', authenticate, [
  param('comment_id').isUUID(),
], validate, postCtrl.deleteComment);

router.use('/posts', postRouter);

// ── VETS ──────────────────────────────────────────────────────
const vetRouter = require('express').Router();

vetRouter.get('/',                    parsePagination, vetCtrl.getVets);
vetRouter.get('/nearby',              authenticate, vetCtrl.getNearbyVets);
vetRouter.get('/:user_id',            vetCtrl.getVetProfile);

vetRouter.post('/appointments', authenticate, [
  body('vet_id').isUUID(),
  body('pet_id').isUUID(),
  body('scheduled_at').isISO8601(),
  body('fee_inr').isFloat({ min: 0 }),
], validate, vetCtrl.bookAppointment);

vetRouter.get('/appointments/mine',   authenticate, parsePagination, vetCtrl.getMyAppointments);
vetRouter.get('/appointments/vet',    authenticate, requireRole('vet'), parsePagination, vetCtrl.getVetAppointments);

vetRouter.patch('/appointments/:appointment_id',
  authenticate, [
  param('appointment_id').isUUID(),
  body('status').isIn(['confirmed','in_progress','completed','cancelled','no_show']),
], validate, vetCtrl.updateAppointment);

vetRouter.post('/appointments/:appointment_id/rate',
  authenticate, [
  param('appointment_id').isUUID(),
  body('rating').isInt({ min:1, max:5 }),
], validate, vetCtrl.rateAppointment);

router.use('/vets', vetRouter);

// ── SEARCH ────────────────────────────────────────────────────
router.get('/search', authenticate, async (req, res, next) => {
  const { q, category = 'all' } = req.query;
  if (!q?.trim()) {
    return res.status(400).json({ success: false, message: 'Query required' });
  }
  try {
    const { query: dbQuery } = require('../config/db');
    const { rows } = await dbQuery(
      `SELECT * FROM fn_search($1, $2)`,
      [q.trim(), category]
    );
    // Log search
    await dbQuery(
      `INSERT INTO "SearchHistory" (user_id, query, category, result_count)
       VALUES ($1, $2, $3, $4)`,
      [req.user.user_id, q, category, rows.length]
    );
    return res.json({ success: true, data: rows });
  } catch (err) { next(err); }
});

// ── NOTIFICATIONS ─────────────────────────────────────────────
router.get('/notifications', authenticate, parsePagination, async (req, res, next) => {
  const { page, limit, offset } = req.pagination;
  try {
    const { query: dbQuery } = require('../config/db');
    const { rows: data } = await dbQuery(
      `SELECT n.*,
              u.username AS sender_username, u.avatar_url AS sender_avatar
         FROM "Notification" n
         LEFT JOIN "User" u ON u.user_id = n.sender_id
        WHERE n.recipient_id = $1
        ORDER BY n.created_at DESC
        LIMIT $2 OFFSET $3`,
      [req.user.user_id, limit, offset]
    );
    const { rows: [{ total }] } = await dbQuery(
      `SELECT COUNT(*) AS total FROM "Notification"
        WHERE recipient_id = $1`,
      [req.user.user_id]
    );
    // Mark all as read
    await dbQuery(
      `UPDATE "Notification"
          SET is_read = TRUE, read_at = NOW()
        WHERE recipient_id = $1 AND is_read = FALSE`,
      [req.user.user_id]
    );
    const R = require('../utils/response');
    return R.paginated(res, data, { page, limit, total: parseInt(total) });
  } catch (err) { next(err); }
});

// ── HEALTH CHECK ──────────────────────────────────────────────
router.get('/health', async (req, res) => {
  const { pool } = require('../config/db');
  try {
    await pool.query('SELECT 1');
    res.json({
      success: true,
      message: 'PawBook API is healthy',
      db: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch {
    res.status(503).json({ success: false, message: 'DB unavailable' });
  }
});
// ═══════════════════════════════════════════════════════════════════════════
// PASTE THIS BLOCK into src/routes/index.js BEFORE 
// ── NEW FEATURE ROUTES ──────────────────────────────────────────
router.use('/appointments',  require('./appointments'));
router.use('/pawmatch',      require('./pawmatch'));
router.use('/vaccinations',  require('./vaccinations'));
router.use('/reviews',       require('./reviews'));
router.use('/notifications', require('./notifications'));
router.use('/insurance',     require('./insurance'));
router.use('/training',      require('./training'));
router.use('/travel',        require('./travel'));
router.use('/businesses', require('./business.routes'));
router.use('/overpass', require('./overpass.routes'));
// ── MESSAGES (DM + Group + Broadcast) ────────────────────────────────────────
const msgCtrl = require('../controllers/message.controller');

// People list & search
router.get('/messages/users',        authenticate, msgCtrl.getUsers);
router.get('/messages/search-users', authenticate, msgCtrl.searchUsers);

// DM Conversations
const convRouter = require('express').Router();
convRouter.get('/',                             authenticate, parsePagination, msgCtrl.getConversations);
convRouter.post('/', authenticate, [
  body('other_user_id').isUUID(),
], validate, msgCtrl.getOrCreateConversation);
convRouter.get('/:conversation_id/messages',    authenticate, parsePagination, msgCtrl.getDMMessages);
convRouter.post('/:conversation_id/messages', authenticate, [
  body('content').trim().isLength({ min:1, max:5000 }),
], validate, msgCtrl.sendDM);
convRouter.patch('/:conversation_id/messages/:message_id', authenticate, [
  body('content').trim().isLength({ min:1, max:5000 }),
], validate, msgCtrl.editDM);
convRouter.delete('/:conversation_id/messages/:message_id', authenticate, msgCtrl.deleteDM);
convRouter.post('/:conversation_id/messages/:message_id/revoke', authenticate, msgCtrl.revokeDM);
router.use('/conversations', convRouter);

// Group Conversations
const gcRouter = require('express').Router();
gcRouter.get('/',    authenticate, msgCtrl.getGroupConvs);
gcRouter.post('/', authenticate, [
  body('name').trim().isLength({ min:1, max:100 }),
  body('member_ids').isArray({ min:1 }),
], validate, msgCtrl.createGroupConv);
gcRouter.get('/:group_conv_id/messages',  authenticate, parsePagination, msgCtrl.getGroupMessages);
gcRouter.post('/:group_conv_id/messages', authenticate, [
  body('content').trim().isLength({ min:1, max:5000 }),
], validate, msgCtrl.sendGroupMessage);
gcRouter.patch('/:group_conv_id/messages/:message_id', authenticate, [
  body('content').trim().isLength({ min:1, max:5000 }),
], validate, msgCtrl.editGroupMessage);
gcRouter.delete('/:group_conv_id/messages/:message_id', authenticate, msgCtrl.deleteGroupMessage);
gcRouter.post('/:group_conv_id/messages/:message_id/revoke', authenticate, msgCtrl.revokeGroupMessage);
gcRouter.post('/:group_conv_id/members', authenticate, [
  body('member_ids').isArray({ min:1 }),
], validate, msgCtrl.addGroupMembers);
router.use('/group-conversations', gcRouter);

// Broadcasts
const bcRouter = require('express').Router();
bcRouter.get('/',    authenticate, parsePagination, msgCtrl.getBroadcasts);
bcRouter.post('/', authenticate, [
  body('content').trim().isLength({ min:1, max:5000 }),
], validate, msgCtrl.sendBroadcast);
bcRouter.patch('/:broadcast_id', authenticate, [
  body('content').trim().isLength({ min:1, max:5000 }),
], validate, msgCtrl.editBroadcast);
bcRouter.post('/:broadcast_id/revoke', authenticate, msgCtrl.revokeBroadcast);
router.use('/broadcasts', bcRouter);
const evtCtrl = require('../controllers/event.controller');
router.get('/events', authenticate, evtCtrl.getEvents);
router.get('/events/:id', authenticate, evtCtrl.getEvent);
router.post('/events', authenticate, evtCtrl.createEvent);
router.post('/events/:id/rsvp', authenticate, evtCtrl.rsvpEvent);
router.delete('/events/:id', authenticate, evtCtrl.deleteEvent);
// ── ADD THESE LINES TO src/routes/index.js ──────────────────────────────────
// Place them before module.exports = router;

const savedCtrl        = require('../controllers/saved.controller');
const fundraisingCtrl  = require('../controllers/fundraising.controller');
const activityCtrl     = require('../controllers/activity.controller');
const memoriesCtrl     = require('../controllers/memories.controller');

// Saved posts
router.get('/saved',              authenticate, savedCtrl.getSaved);
router.post('/saved/:postId',     authenticate, savedCtrl.savePost);
router.delete('/saved/:postId',   authenticate, savedCtrl.unsavePost);

// Fundraising
router.get('/fundraising',            authenticate, fundraisingCtrl.getCampaigns);
router.get('/fundraising/:id',        authenticate, fundraisingCtrl.getCampaign);
router.post('/fundraising',           authenticate, fundraisingCtrl.createCampaign);
router.post('/fundraising/:id/donate',authenticate, fundraisingCtrl.donate);

// Activity log
router.get('/activity',   authenticate, activityCtrl.getActivity);
router.post('/activity',  authenticate, activityCtrl.logActivity);

// Memories & Birthdays
router.get('/memories',   authenticate, memoriesCtrl.getMemories);
router.get('/birthdays',  authenticate, memoriesCtrl.getBirthdays);

module.exports = router;