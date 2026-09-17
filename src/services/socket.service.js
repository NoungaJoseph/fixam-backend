const socketio = require('socket.io');
const jwt = require('jsonwebtoken');
const prisma = require('../config/prisma');

let io;
const users = new Map(); // userId -> socketId
const userSockets = new Map(); // userId -> active socket count
const debugLog = (...args) => {
  if (process.env.NODE_ENV !== 'production') console.log(...args);
};

const initSocket = (server) => {
  const allowedOrigins = [
    process.env.DASHBOARD_URL,
    process.env.WEBSITE_URL,
    'https://dashboard.usefixam.com',
    'https://usefixam.com',
    'https://fixam-website-psi.vercel.app',
    ...(process.env.NODE_ENV === 'production' ? [] : [
      'http://localhost:3000',
      'http://localhost:4000',
      'http://localhost:5173'
    ])
  ].filter(Boolean);

  io = socketio(server, {
    cors: {
      origin: (origin, callback) => {
        const isLocalDev = process.env.NODE_ENV !== 'production'
          && (origin?.startsWith('http://192.168.') || origin?.startsWith('http://localhost') || origin?.startsWith('http://10.'));
        if (!origin || allowedOrigins.includes(origin) || isLocalDev) return callback(null, true);
        return callback(new Error('Not allowed by CORS'));
      },
      methods: ["GET", "POST"]
    }
  });

  // Authentication Middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Authentication error'));

      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      socket.userId = decoded.id;
      next();
    } catch (err) {
      next(new Error('Authentication error'));
    }
  });

  io.on('connection', async (socket) => {
    debugLog(`User connected: ${socket.userId}`);
    users.set(socket.userId, socket.id);
    userSockets.set(socket.userId, (userSockets.get(socket.userId) || 0) + 1);

    // Update client/admin presence automatically. Provider availability is controlled by the provider toggle.
    try {
      const user = await prisma.user.findUnique({ where: { id: socket.userId }, select: { role: true } });
      if (user?.role !== 'PROVIDER') {
        await prisma.user.update({
        where: { id: socket.userId },
        data: { isOnline: true }
        });
      }
    } catch (dbError) {
      // P2025 = Record not found, which is okay - user may not exist yet
      if (dbError.code !== 'P2025') {
        console.error('Failed to update user online status:', dbError.message);
      }
    }

    // Join user-specific room for notifications
    socket.join(socket.userId);

    // --- CHAT EVENTS ---
    socket.on('join:conversation', (conversationId) => {
      socket.join(conversationId);
      debugLog(`User ${socket.userId} joined conversation: ${conversationId}`);
    });

    socket.on('typing', ({ conversationId, isTyping }) => {
      socket.to(conversationId).emit('user:typing', { userId: socket.userId, isTyping });
    });

    socket.on('message:send', ({ conversationId, message }) => {
      // Broadcast to all users in the conversation
      io.to(conversationId).emit('message:new', message);
    });



    // --- DISCONNECT ---
    socket.on('disconnect', async () => {
      debugLog(`User disconnected: ${socket.userId}`);
      users.delete(socket.userId);
      const remaining = Math.max((userSockets.get(socket.userId) || 1) - 1, 0);
      if (remaining > 0) {
        userSockets.set(socket.userId, remaining);
        return;
      }
      userSockets.delete(socket.userId);
      
      try {
        const user = await prisma.user.findUnique({ where: { id: socket.userId }, select: { role: true } });
        if (user?.role !== 'PROVIDER') {
          await prisma.user.update({
            where: { id: socket.userId },
            data: { isOnline: false, lastSeen: new Date() }
          });
        } else {
          await prisma.user.update({
            where: { id: socket.userId },
            data: { lastSeen: new Date() }
          });
        }
      } catch (dbError) {
        // P2025 = Record not found, which is okay
        if (dbError.code !== 'P2025') {
          console.error('Failed to update user offline status:', dbError.message);
        }
      }
    });
  });

  return io;
};

const getIO = () => {
  if (!io) throw new Error('Socket.io not initialized');
  return io;
};

module.exports = { initSocket, getIO };
