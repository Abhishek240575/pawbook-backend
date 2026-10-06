-- PawBook Backend — New Feature Tables Migration
-- Run this on your Neon PostgreSQL console or via psql

-- ─────────────────────────────────────────────
-- 1. APPOINTMENTS (Vet Booking)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS appointments (
  id            SERIAL PRIMARY KEY,
  booking_id    VARCHAR(32) UNIQUE NOT NULL,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id        INTEGER REFERENCES pets(id) ON DELETE SET NULL,
  vet_id        INTEGER,                        -- future: vet table
  vet_name      VARCHAR(120) NOT NULL,
  vet_spec      VARCHAR(120),
  vet_img       TEXT,
  consult_type  VARCHAR(20) NOT NULL DEFAULT 'video',  -- video|audio|clinic
  appt_date     DATE NOT NULL,
  appt_time     VARCHAR(20) NOT NULL,
  reason        TEXT,
  fee           INTEGER NOT NULL DEFAULT 0,
  status        VARCHAR(20) NOT NULL DEFAULT 'confirmed', -- confirmed|cancelled|completed|rescheduled
  refund_status VARCHAR(20) DEFAULT 'none',    -- none|pending|processed
  refund_amount INTEGER DEFAULT 0,
  cancel_reason TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_appt_user ON appointments(user_id);
CREATE INDEX IF NOT EXISTS idx_appt_status ON appointments(status);

-- ─────────────────────────────────────────────
-- 2. PAWMATCH SWIPES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pawmatch_swipes (
  id          SERIAL PRIMARY KEY,
  swiper_pet_id   INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  swiped_pet_id   INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  direction   VARCHAR(10) NOT NULL,   -- right|left|super
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(swiper_pet_id, swiped_pet_id)
);
CREATE INDEX IF NOT EXISTS idx_swipe_swiper ON pawmatch_swipes(swiper_pet_id);
CREATE INDEX IF NOT EXISTS idx_swipe_swiped ON pawmatch_swipes(swiped_pet_id);

-- ─────────────────────────────────────────────
-- 3. PAWMATCH MATCHES (mutual likes)
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pawmatch_matches (
  id          SERIAL PRIMARY KEY,
  pet_a_id    INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  pet_b_id    INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  matched_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(LEAST(pet_a_id,pet_b_id), GREATEST(pet_a_id,pet_b_id))
);

-- ─────────────────────────────────────────────
-- 4. VACCINATIONS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vaccinations (
  id            SERIAL PRIMARY KEY,
  pet_id        INTEGER NOT NULL REFERENCES pets(id) ON DELETE CASCADE,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vaccine_name  VARCHAR(120) NOT NULL,
  given_date    DATE NOT NULL,
  next_due_date DATE,
  vet_name      VARCHAR(120),
  clinic_name   VARCHAR(120),
  batch_number  VARCHAR(60),
  notes         TEXT,
  doc_url       TEXT,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_vacc_pet ON vaccinations(pet_id);

-- ─────────────────────────────────────────────
-- 5. MARKETPLACE REVIEWS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS marketplace_reviews (
  id          SERIAL PRIMARY KEY,
  product_id  VARCHAR(60) NOT NULL,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating      SMALLINT NOT NULL CHECK(rating BETWEEN 1 AND 5),
  title       VARCHAR(120),
  body        TEXT,
  verified    BOOLEAN DEFAULT FALSE,
  helpful     INTEGER DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(product_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_review_product ON marketplace_reviews(product_id);

-- ─────────────────────────────────────────────
-- 6. NOTIFICATIONS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id          SERIAL PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(40) NOT NULL,  -- like|comment|match|appointment|system|follow
  title       VARCHAR(200),
  body        TEXT,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ref_type    VARCHAR(40),           -- post|pet|appointment|match
  ref_id      INTEGER,
  is_read     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(user_id, is_read);

-- ─────────────────────────────────────────────
-- 7. GROUPS + MEMBERSHIPS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS groups (
  id          SERIAL PRIMARY KEY,
  name        VARCHAR(120) NOT NULL,
  description TEXT,
  cover_img   TEXT,
  privacy     VARCHAR(20) DEFAULT 'public',  -- public|private
  category    VARCHAR(60),
  owner_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  member_count INTEGER DEFAULT 1,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_memberships (
  id        SERIAL PRIMARY KEY,
  group_id  INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role      VARCHAR(20) DEFAULT 'member',   -- admin|moderator|member
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_gm_group ON group_memberships(group_id);
CREATE INDEX IF NOT EXISTS idx_gm_user  ON group_memberships(user_id);

-- ─────────────────────────────────────────────
-- 8. INSURANCE POLICIES
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS insurance_policies (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id        INTEGER REFERENCES pets(id) ON DELETE SET NULL,
  provider      VARCHAR(120) NOT NULL,
  plan_name     VARCHAR(120),
  policy_number VARCHAR(80),
  premium       INTEGER,             -- monthly in paise
  coverage      INTEGER,             -- annual in paise
  start_date    DATE,
  end_date      DATE,
  status        VARCHAR(20) DEFAULT 'active',  -- active|expired|cancelled
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_insurance_user ON insurance_policies(user_id);

-- ─────────────────────────────────────────────
-- 9. TRAINING SESSIONS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_sessions (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id        INTEGER REFERENCES pets(id) ON DELETE SET NULL,
  trainer_name  VARCHAR(120),
  skill         VARCHAR(120) NOT NULL,
  session_date  DATE,
  duration_min  INTEGER DEFAULT 30,
  notes         TEXT,
  completed     BOOLEAN DEFAULT FALSE,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_training_user ON training_sessions(user_id);

-- ─────────────────────────────────────────────
-- 10. PET TRAVEL PLANS
-- ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS travel_plans (
  id            SERIAL PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pet_id        INTEGER REFERENCES pets(id) ON DELETE SET NULL,
  destination   VARCHAR(200) NOT NULL,
  travel_date   DATE,
  return_date   DATE,
  transport     VARCHAR(40) DEFAULT 'car',    -- car|flight|train|bus
  accommodation VARCHAR(200),
  notes         TEXT,
  status        VARCHAR(20) DEFAULT 'planned', -- planned|ongoing|completed
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_travel_user ON travel_plans(user_id);
