const router = require('express').Router();
const { body, param, query } = require('express-validator');
const marketCtrl = require('../controllers/marketplace.controller');

const {
  authenticate, requireRole, requireVerified,
  validate, parsePagination
} = require('../middleware');

const authCtrl         = require('../controllers/auth.controller');
const userCtrl         = require('../controllers/user.controller');
const petCtrl          = require('../controllers/pet.controller');
const postCtrl         = require('../controllers/post.controller');
const vetCtrl          = require('../controllers/vet.controller');
const savedCtrl        = require('../controllers/saved.controller');
const fundraisingCtrl  = require('../controllers/fundraising.controller');
const activityCtrl     = require('../controllers/activity.controller');
const memoriesCtrl     = require('../controllers/memories.controller');
const mediaCtrl        = require('../controllers/media.controller');
const evtCtrl          = require('../controllers/event.controller');
const msgCtrl          = require('../controllers/message.controller');
const adoptionCtrl     = require('../controllers/adoption.controller');
const nutrCtrl         = require('../controllers/nutrition.controller');
const trainCtrl        = require('../controllers/training.controller');
const analyticsCtrl    = require('../controllers/analytics.controller');
const notifCtrl        = require('../controllers/notifications.controller');
const insuranceCtrl    = require('../controllers/insurance.controller');
const trainingCtrl     = require('../controllers/training.controller');
const travelCtrl       = require('../controllers/travel.controller');






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
// Static paths MUST come before /:id to avoid interception
router.get('/vets',                vetCtrl.getVets);
router.get('/vets/chats',          authenticate, vetCtrl.getVetChats);
router.post('/vets/register',      authenticate, vetCtrl.registerVet);

// Parameterized vet routes
router.get('/vets/:id',            vetCtrl.getVetProfile);
router.get('/vets/:id/slots',      vetCtrl.getVetSlots);
router.post('/vets/:id/review',    authenticate, [
  body('rating').isInt({ min:1, max:5 }),
], validate, vetCtrl.reviewVet);

// ── APPOINTMENTS ──────────────────────────────────────────────
router.post('/appointments', authenticate, [
  body('vet_id').isUUID(),
  body('appt_date').notEmpty(),
  body('appt_time').notEmpty(),
  body('consult_type').isIn(['Video','Chat','In-Clinic']),
], validate, vetCtrl.bookAppointment);

router.get('/appointments',        authenticate, vetCtrl.getAppointments);
router.get('/appointments/:id',    authenticate, vetCtrl.getAppointment);
router.patch('/appointments/:id',  authenticate, vetCtrl.updateAppointment);

// ── PRESCRIPTIONS ─────────────────────────────────────────────
router.get('/prescriptions',       authenticate, vetCtrl.getPrescriptions);
router.get('/prescriptions/:id',   authenticate, vetCtrl.getPrescription);

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

// ── OTHER FEATURE ROUTES ───────────────────────────────────────
// appointments handled by flat routes above (vetCtrl)
router.use('/pawmatch',      require('./pawmatch'));
router.use('/vaccinations',  require('./vaccinations'));
router.use('/reviews',       require('./reviews'));
router.use('/insurance',     require('./insurance'));
router.use('/training',      require('./training'));
router.use('/travel',        require('./travel'));
router.use('/businesses',    require('./business.routes'));
router.use('/overpass',      require('./overpass.routes'));

// ── MESSAGES (DM + Group + Broadcast) ────────────────────────────────────────
router.get('/messages/users',        authenticate, msgCtrl.getUsers);
router.get('/messages/search-users', authenticate, msgCtrl.searchUsers);

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

// ── EVENTS ────────────────────────────────────────────────────
router.get('/events',          authenticate, evtCtrl.getEvents);
router.get('/events/:id',      authenticate, evtCtrl.getEvent);
router.post('/events',         authenticate, evtCtrl.createEvent);
router.post('/events/:id/rsvp',authenticate, evtCtrl.rsvpEvent);
router.delete('/events/:id',   authenticate, evtCtrl.deleteEvent);

// ── SAVED ─────────────────────────────────────────────────────
router.get('/saved',              authenticate, savedCtrl.getSaved);
router.post('/saved/:postId',     authenticate, savedCtrl.savePost);
router.delete('/saved/:postId',   authenticate, savedCtrl.unsavePost);

// ── FUNDRAISING ───────────────────────────────────────────────
router.get('/fundraising',             authenticate, fundraisingCtrl.getCampaigns);
router.get('/fundraising/:id',         authenticate, fundraisingCtrl.getCampaign);
router.post('/fundraising',            authenticate, fundraisingCtrl.createCampaign);
router.post('/fundraising/:id/donate', authenticate, fundraisingCtrl.donate);

// ── ACTIVITY ──────────────────────────────────────────────────
router.get('/activity',   authenticate, activityCtrl.getActivity);
router.post('/activity',  authenticate, activityCtrl.logActivity);

// ── MEMORIES & BIRTHDAYS ──────────────────────────────────────
router.get('/memories',   authenticate, memoriesCtrl.getMemories);
router.get('/birthdays',  authenticate, memoriesCtrl.getBirthdays);

// ── MEDIA GALLERY ─────────────────────────────────────────────
router.get('/media/gallery',        authenticate, mediaCtrl.getGallery);
router.get('/media/highlights',     authenticate, mediaCtrl.getHighlights);
router.get('/media/tagged',         authenticate, mediaCtrl.getTagged);
router.get('/media/albums',         authenticate, mediaCtrl.getAlbums);
router.post('/media/albums',        authenticate, mediaCtrl.createAlbum);
router.get('/media/albums/:id',     authenticate, mediaCtrl.getAlbum);
router.patch('/media/albums/:id',   authenticate, mediaCtrl.updateAlbum);
router.delete('/media/albums/:id',  authenticate, mediaCtrl.deleteAlbum);
router.post('/media/upload',        authenticate, mediaCtrl.uploadMedia);
router.patch('/media/:id',          authenticate, mediaCtrl.updateMedia);
router.delete('/media/:id',         authenticate, mediaCtrl.deleteMedia);

// ── Adoption routes ──────────────────────────────────────────────
router.get('/adoptions/pets', adoptionCtrl.getPets);
router.get('/adoptions/pets/:id', adoptionCtrl.getPetById);
router.get('/adoptions/shelters', adoptionCtrl.getShelters);
router.post('/adoptions/inquire', authenticate, adoptionCtrl.createInquiry);
router.get('/adoptions/my-inquiries', authenticate, adoptionCtrl.getMyInquiries);

// ── MARKETPLACE ───────────────────────────────────────────────
const marketRouter = require('express').Router();

// ── PUBLIC BROWSE ─────────────────────────────────────────────
marketRouter.get('/products',              marketCtrl.getProducts);
marketRouter.get('/products/:product_id',  marketCtrl.getProduct);
marketRouter.get('/listings',              marketCtrl.getListings);
marketRouter.get('/listings/:listing_id',  marketCtrl.getListing);

// ── STORE (seller) ────────────────────────────────────────────
marketRouter.post('/store', authenticate, [
  body('name').trim().isLength({ min: 2, max: 100 }),
], validate, marketCtrl.createStore);

marketRouter.get('/store/me',   authenticate, marketCtrl.getMyStore);
marketRouter.patch('/store/me', authenticate, marketCtrl.updateMyStore);

// ── LISTINGS (seller CRUD) ────────────────────────────────────
marketRouter.post('/listings', authenticate, [
  body('title').trim().notEmpty(),
  body('price').isFloat({ min: 0 }),
  body('category').optional().isIn(['pet-products','food','grooming','accessories','vet-services']),
], validate, marketCtrl.createListing);

marketRouter.patch('/listings/:listing_id',  authenticate, marketCtrl.updateListing);
marketRouter.delete('/listings/:listing_id', authenticate, marketCtrl.deleteListing);

// ── REVIEWS ───────────────────────────────────────────────────
marketRouter.get('/listings/:listing_id/reviews',  marketCtrl.getReviews);
marketRouter.post('/listings/:listing_id/reviews', authenticate, [
  body('rating').isInt({ min: 1, max: 5 }),
], validate, marketCtrl.addReview);

// ── CART ──────────────────────────────────────────────────────
marketRouter.get('/cart', authenticate, marketCtrl.getCart);
marketRouter.post('/cart', authenticate, [
  body('product_id').optional().isUUID(),
  body('listing_id').optional().isUUID(),
  body('quantity').optional().isInt({ min: 1 }),
], validate, marketCtrl.addToCart);
marketRouter.patch('/cart/:cart_id', authenticate, [
  body('quantity').isInt({ min: 1 }),
], validate, marketCtrl.updateCartItem);
marketRouter.delete('/cart/:cart_id', authenticate, marketCtrl.removeFromCart);

// ── ORDERS — static routes BEFORE parameterized ───────────────
marketRouter.get('/orders/seller',             authenticate, marketCtrl.getSellerOrders);
marketRouter.post('/orders', authenticate, [
  body('delivery_address').optional(),
  body('payment_method').optional().isIn(['cod','upi','card','netbanking']),
], validate, marketCtrl.placeOrder);
marketRouter.get('/orders',                    authenticate, marketCtrl.getMyOrders);
marketRouter.get('/orders/:order_id',          authenticate, marketCtrl.getOrder);
marketRouter.patch('/orders/:order_id/status', authenticate, [
  body('status').isIn(['pending','confirmed','shipped','delivered','cancelled','refunded']),
], validate, marketCtrl.updateOrderStatus);

router.use('/marketplace', marketRouter);

// ── NUTRITION ─────────────────────────────────────────────────
// Add this require near the top of index.js with the other controllers:
// const nutrCtrl = require('../controllers/nutrition.controller');
//
// Then add this block before module.exports = router;

const nutrRouter = require('express').Router();

nutrRouter.get('/plans',          nutrCtrl.getPlans);
nutrRouter.get('/plans/:id',      nutrCtrl.getPlan);
nutrRouter.get('/foods',          nutrCtrl.getFoods);
nutrRouter.get('/recommend',      nutrCtrl.recommend);
nutrRouter.get('/my-plans',       authenticate, nutrCtrl.getMyPlans);
nutrRouter.post('/my-plans',      authenticate, [
  body('plan_id').optional().isInt(),
  body('pet_id').optional().isUUID(),
], validate, nutrCtrl.savePlan);
nutrRouter.delete('/my-plans/:id', authenticate, nutrCtrl.removePlan);

router.use('/nutrition', nutrRouter);

// ── TRAINING ──────────────────────────────────────────────────
// 1. Add near the top of index.js with other controller requires:
//    const trainCtrl = require('../controllers/training.controller');
// before module.exports = router:
const notifRouter = require('express').Router();
notifRouter.get('/',           authenticate, notifCtrl.getNotifications);
notifRouter.patch('/read-all', authenticate, notifCtrl.markAllRead);
notifRouter.patch('/:id/read', authenticate, notifCtrl.markOneRead);
notifRouter.post('/',          authenticate, [body('user_id').notEmpty(), body('title').notEmpty()], validate, notifCtrl.createNotification);
notifRouter.delete('/:id',     authenticate, notifCtrl.deleteNotification);
router.use('/notifications', notifRouter);


// ── Insurance ────────────────────────────────────────────
const insuranceRouter = require('express').Router();
insuranceRouter.get('/plans',      insuranceCtrl.getPlans);
insuranceRouter.get('/my',         authenticate, insuranceCtrl.getMy);
insuranceRouter.post('/subscribe', authenticate, [body('plan_id').notEmpty()], validate, insuranceCtrl.subscribe);
insuranceRouter.delete('/:id',     authenticate, insuranceCtrl.cancel);
router.use('/insurance', insuranceRouter);

// ── Training ──────────────────────────────────────────────
const trainingRouter = require('express').Router();
trainingRouter.get('/programs',             trainingCtrl.getPrograms);
trainingRouter.get('/programs/:id/lessons', trainingCtrl.getLessons);
trainingRouter.get('/my',                   authenticate, trainingCtrl.getMy);
trainingRouter.post('/enroll',              authenticate, [body('program_id').notEmpty()], validate, trainingCtrl.enroll);
trainingRouter.patch('/progress/:id',       authenticate, trainingCtrl.updateProgress);
router.use('/training', trainingRouter);

// ── Travel ────────────────────────────────────────────────
const travelRouter = require('express').Router();
travelRouter.get('/destinations',       travelCtrl.getDestinations);
travelRouter.get('/destinations/:id',   travelCtrl.getDestination);
travelRouter.get('/saved',              authenticate, travelCtrl.getMySaved);
travelRouter.post('/save',              authenticate, [body('dest_id').notEmpty()], validate, travelCtrl.saveDestination);
travelRouter.delete('/save/:dest_id',   authenticate, travelCtrl.unsaveDestination);
router.use('/travel', travelRouter);

// ── Analytics ─────────────────────────────────────────────
const analyticsRouter = require('express').Router();
analyticsRouter.get('/me', authenticate, analyticsCtrl.getMyAnalytics);
router.use('/analytics', analyticsRouter);


/**
 * ADD THIS BLOCK to src/routes/index.js
 * Place just before the final module.exports = router line
 *
 * Also add at the TOP of index.js (with other requires):
 *   const insuranceCtrl = require('../controllers/insurance.controller');
 *   const trainingCtrl  = require('../controllers/training.controller');
 *   const travelCtrl    = require('../controllers/travel.controller');
 *   const analyticsCtrl = require('../controllers/analytics.controller');
 */

// ── Insurance ──────────────────────────────────────────────
const insuranceRouter = require('express').Router();
insuranceRouter.get('/plans',      insuranceCtrl.getPlans);
insuranceRouter.get('/my',         authenticate, insuranceCtrl.getMy);
insuranceRouter.post('/subscribe', authenticate, [body('plan_id').notEmpty()], validate, insuranceCtrl.subscribe);
insuranceRouter.delete('/:id',     authenticate, insuranceCtrl.cancel);
router.use('/insurance', insuranceRouter);

// ── Training ───────────────────────────────────────────────
const trainingRouter = require('express').Router();
trainingRouter.get('/programs',              trainingCtrl.getPrograms);
trainingRouter.get('/programs/:id/lessons',  trainingCtrl.getLessons);
trainingRouter.get('/my',                    authenticate, trainingCtrl.getMy);
trainingRouter.post('/enroll',               authenticate, [body('program_id').notEmpty()], validate, trainingCtrl.enroll);
trainingRouter.patch('/progress/:id',        authenticate, trainingCtrl.updateProgress);
router.use('/training', trainingRouter);

// ── Travel ─────────────────────────────────────────────────
const travelRouter = require('express').Router();
travelRouter.get('/destinations',          travelCtrl.getDestinations);
travelRouter.get('/destinations/:id',      travelCtrl.getDestination);
travelRouter.get('/saved',                 authenticate, travelCtrl.getMySaved);
travelRouter.post('/save',                 authenticate, [body('dest_id').notEmpty()], validate, travelCtrl.saveDestination);
travelRouter.delete('/save/:dest_id',      authenticate, travelCtrl.unsaveDestination);
router.use('/travel', travelRouter);

// ── Analytics ──────────────────────────────────────────────
const analyticsRouter = require('express').Router();
analyticsRouter.get('/me', authenticate, analyticsCtrl.getMyAnalytics);
router.use('/analytics', analyticsRouter);


module.exports = router;
