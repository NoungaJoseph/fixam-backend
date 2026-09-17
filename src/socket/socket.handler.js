const socketHandler = (io) => {
  io.on('connection', (socket) => {
    console.log('🔌 New Client Connected:', socket.id);

    // Join User-specific Room
    socket.on('join', (userId) => {
      socket.join(userId);
      console.log(`👤 User ${userId} joined their private room.`);
    });

    // Real-time Chat
    socket.on('sendMessage', (data) => {
      // data: { senderId, receiverId, content }
      io.to(data.receiverId).emit('receiveMessage', data);
    });

    // Job Alerts for Providers
    socket.on('newJobAlert', (data) => {
      // Broadcast to all providers or specific category room
      socket.broadcast.emit('jobNotification', data);
    });

    socket.on('disconnect', () => {
      console.log('❌ Client Disconnected:', socket.id);
    });
  });
};

module.exports = socketHandler;
