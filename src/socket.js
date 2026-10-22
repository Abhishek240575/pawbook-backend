// src/socket.js  —  Socket.io server for PawBook
// Attach to Express HTTP server, handles:
//   - Auth via JWT
//   - Real-time messages (1:1 conversations)
//   - Real-time notifications
//   - Typing indicators
//   - Online presence

const { Server }  = require('socket.io');
const jwt         = require('jsonwebtoken');
const { query }   = require('./config/db');
const logger      = require('./utils/logger');

// Map: user_id → Set<socket.id>
const onlineUsers = new Map();

function initSocket(httpServer) {
  const io = new Server(httpServer, {
    cors: {
      origin: [
        'https://pawbook-frontend-cyxo.onrender.com',
        'http://localhost:3000',
        'http://localhost:62814',
        'http://127.0.0.1:5500',
      ],
      credentials: true,
    },
    pingTimeout:  60000,
    pingInterval: 25000,
  });

  // ── Auth middleware ──────────────────────────────────────────────────────────
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token
                 || socket.handshake.headers?.authorization?.replace('Bearer ', '');
      if (!token) return next(new Error('No token'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.user_id = decoded.user_id || decoded.id;
      socket.role    = decoded.role || 'user';
      next();
    } catch (err) {
      next(new Error('Invalid token'));
    }
  });

  // ── Connection ───────────────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    const uid = socket.user_id;
    logger.info(`[Socket] Connected: user=${uid} socket=${socket.id}`);

    // Track online
    if (!onlineUsers.has(uid)) onlineUsers.set(uid, new Set());
    onlineUsers.get(uid).add(socket.id);

    // Join personal notification room
    socket.join(`user:${uid}`);

    // Broadcast online status to followers (non-blocking)
    broadcastPresence(io, uid, true);

    // ── Events ──────────────────────────────────────────────────────────────────

    socket.on('join_conversation', ({ conversation_id }) => {
      if (!conversation_id) return;
      socket.join(`conv:${conversation_id}`);
    });

    socket.on('leave_conversation', ({ conversation_id }) => {
      if (!conversation_id) return;
      socket.leave(`conv:${conversation_id}`);
    });

    socket.on('send_message', async ({ conversation_id, content }) => {
      if (!conversation_id || !content?.trim()) return;
      try {
        // Persist to DB
        const { rows } = await query(
          `INSERT INTO messages (conversation_id, sender_id, content, created_at)
           VALUES ($1, $2, $3, NOW()) RETURNING *`,
          [conversation_id, uid, content.trim()]
        );
        const msg = rows[0];

        // Emit to all participants in the conversation room
        io.to(`conv:${conversation_id}`).emit('new_message', {
          conversation_id,
          message: {
            message_id:      msg.message_id,
            conversation_id: msg.conversation_id,
            sender_id:       msg.sender_id,
            content:         msg.content,
            created_at:      msg.created_at,
          },
        });

        // Notify recipients who may not be in the room
        await notifyConversationParticipants(io, conversation_id, uid, msg);
      } catch (err) {
        logger.error('[Socket] send_message error', { error: err.message });
        socket.emit('error', { message: 'Message delivery failed' });
      }
    });

    socket.on('typing', ({ conversation_id, is_typing }) => {
      if (!conversation_id) return;
      socket.to(`conv:${conversation_id}`).emit('typing', {
        conversation_id,
        user_id:  uid,
        is_typing: !!is_typing,
      });
    });

    socket.on('mark_read', async ({ conversation_id }) => {
      if (!conversation_id) return;
      try {
        await query(
          `UPDATE messages SET read_at = NOW()
           WHERE conversation_id = $1 AND sender_id != $2 AND read_at IS NULL`,
          [conversation_id, uid]
        );
        socket.to(`conv:${conversation_id}`).emit('message_read', {
          conversation_id,
          read_by: uid,
        });
      } catch (_) {}
    });

    // ── Disconnect ─────────────────────────────────────────────────────────────

    socket.on('disconnect', () => {
      const sockets = onlineUsers.get(uid);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(uid);
          broadcastPresence(io, uid, false);
        }
      }
      logger.info(`[Socket] Disconnected: user=${uid} socket=${socket.id}`);
    });
  });

  return io;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function broadcastPresence(io, userId, isOnline) {
  try {
    // Get followers/following to notify
    const { rows } = await query(
      `SELECT follower_id AS uid FROM follows WHERE following_id = $1
       UNION
       SELECT following_id AS uid FROM follows WHERE follower_id = $1`,
      [userId]
    );
    rows.forEach(r => {
      io.to(`user:${r.uid}`).emit(isOnline ? 'user_online' : 'user_offline', {
        user_id: userId,
      });
    });
  } catch (_) {}
}

async function notifyConversationParticipants(io, conversationId, senderId, message) {
  try {
    const { rows } = await query(
      `SELECT user_id FROM conversation_participants
       WHERE conversation_id = $1 AND user_id != $2`,
      [conversationId, senderId]
    );
    rows.forEach(r => {
      io.to(`user:${r.user_id}`).emit('new_message', {
        conversation_id: conversationId,
        message,
      });
    });
  } catch (_) {}
}

/**
 * Send a real-time notification to a specific user.
 * Call from any controller: sendNotification(io, userId, notif)
 */
async function sendNotification(io, userId, notification) {
  if (!io) return;
  io.to(`user:${userId}`).emit('new_notification', { notification });
}

/**
 * Check if a user is currently online.
 */
function isUserOnline(userId) {
  return onlineUsers.has(userId) && onlineUsers.get(userId).size > 0;
}

module.exports = { initSocket, sendNotification, isUserOnline };
