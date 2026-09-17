# PawBook API
### Node.js + Express + pg (raw SQL) — connects to Neon PostgreSQL

---

## Setup

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in your Neon connection string
cp .env.example .env

# 3. Start development server (auto-restarts on file change)
npm run dev

# 4. Start production server
npm start
```

Your `.env` needs at minimum:
```
DATABASE_URL=postgresql://...your neon connection string...
JWT_SECRET=any_long_random_string_at_least_64_chars
```

---

## Project structure

```
src/
├── server.js              # Express app entry point
├── config/
│   └── db.js              # pg Pool — query() and getClient()
├── middleware/
│   └── index.js           # authenticate, validate, rate limit, errorHandler
├── controllers/
│   ├── auth.controller.js # register, login, refresh, me, changePassword
│   ├── user.controller.js # profile, follow, block, search
│   ├── pet.controller.js  # CRUD, health timeline, vaccinations
│   ├── post.controller.js # feed, posts, reactions, comments
│   └── vet.controller.js  # directory, nearby, appointments
├── routes/
│   └── index.js           # All routes wired with validators
└── utils/
    ├── response.js        # Standardised JSON response helpers
    └── logger.js          # Winston logger
```

---

## API Reference

### Auth
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/api/v1/auth/register` | — | Register new user |
| POST | `/api/v1/auth/login` | — | Login, returns JWT |
| POST | `/api/v1/auth/refresh` | — | Refresh access token |
| GET  | `/api/v1/auth/me` | ✅ | Get current user |
| PATCH| `/api/v1/auth/password` | ✅ | Change password |

### Users
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET  | `/api/v1/users/search?q=` | ✅ | Search users |
| GET  | `/api/v1/users/:username/profile` | — | Public profile |
| GET  | `/api/v1/users/:user_id/followers` | ✅ | Followers list |
| GET  | `/api/v1/users/:user_id/following` | ✅ | Following list |
| GET  | `/api/v1/users/:user_id/posts` | ✅ | User's posts |
| PATCH| `/api/v1/users/me` | ✅ | Update my profile |
| PATCH| `/api/v1/users/me/preferences` | ✅ | Update preferences |
| DELETE| `/api/v1/users/me` | ✅ | Deactivate account |
| POST | `/api/v1/users/:user_id/follow` | ✅ | Follow / unfollow toggle |
| POST | `/api/v1/users/:user_id/block` | ✅ | Block / unblock toggle |

### Pets
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET  | `/api/v1/pets/my` | ✅ | My pets |
| GET  | `/api/v1/pets/vaccinations/due` | ✅ | Upcoming vaccination dues |
| GET  | `/api/v1/pets/:pet_id` | — | Pet public profile |
| GET  | `/api/v1/pets/:pet_id/health` | ✅ | Full health timeline |
| POST | `/api/v1/pets` | ✅ | Create pet |
| PATCH| `/api/v1/pets/:pet_id` | ✅ | Update pet |
| DELETE| `/api/v1/pets/:pet_id` | ✅ | Soft delete pet |
| POST | `/api/v1/pets/:pet_id/vaccinations` | ✅ | Add vaccination record |

### Posts & Feed
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET  | `/api/v1/posts/feed` | ✅ | Personalised home feed |
| GET  | `/api/v1/posts/:post_id` | — | Single post |
| GET  | `/api/v1/posts/:post_id/comments` | — | Post comments |
| POST | `/api/v1/posts` | ✅ | Create post |
| PATCH| `/api/v1/posts/:post_id` | ✅ | Edit post |
| DELETE| `/api/v1/posts/:post_id` | ✅ | Delete post |
| POST | `/api/v1/posts/:post_id/react` | ✅ | React / unreact |
| POST | `/api/v1/posts/:post_id/comments` | ✅ | Add comment |
| DELETE| `/api/v1/posts/comments/:comment_id` | ✅ | Delete comment |

### Vets
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET  | `/api/v1/vets` | — | Vet directory |
| GET  | `/api/v1/vets/nearby?lat=&lng=&km=` | ✅ | Nearby vets |
| GET  | `/api/v1/vets/:user_id` | — | Vet profile |
| POST | `/api/v1/vets/appointments` | ✅ | Book appointment |
| GET  | `/api/v1/vets/appointments/mine` | ✅ | My appointments (owner) |
| GET  | `/api/v1/vets/appointments/vet` | ✅ vet | Vet's appointments |
| PATCH| `/api/v1/vets/appointments/:id` | ✅ | Update appointment status |
| POST | `/api/v1/vets/appointments/:id/rate` | ✅ | Rate completed consult |

### Other
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET  | `/api/v1/search?q=&category=` | ✅ | Unified full-text search |
| GET  | `/api/v1/notifications` | ✅ | Get + mark notifications read |
| GET  | `/api/v1/health` | — | API + DB health check |

---

## Response format

Every response follows this structure:
```json
{
  "success": true,
  "message": "Success",
  "data": { ... },
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 100,
    "total_pages": 5,
    "has_next": true,
    "has_prev": false
  }
}
```

---

## Pagination

Add `?page=1&limit=20` to any list endpoint. Max limit is 100.

---

## Auth header

```
Authorization: Bearer <your_jwt_token>
```
