const prisma = require('../config/prisma');
const { getIO } = require('../services/socket.service');

const initiateCall = async (req, res, next) => {
  try {
    const { receiverId, type } = req.body;
    if (!receiverId) {
      return res.status(400).json({ success: false, message: 'Receiver is required' });
    }

    const call = await prisma.callSession.create({
      data: {
        callerId: req.user.id,
        receiverId,
        type: type || 'AUDIO',
        status: 'PENDING'
      }
    });

    try {
      const io = getIO();
      io.to(receiverId).emit('call:incoming', {
        callId: call.id,
        callerId: req.user.id,
        type: call.type
      });
    } catch (err) {
      console.error('[Socket Error] Call notification failed:', err.message);
    }

    res.status(201).json({ success: true, data: call });
  } catch (error) {
    next(error);
  }
};

const updateCallStatus = async (req, res, next) => {
  try {
    const { callId } = req.params;
    const { status } = req.body;
    
    const updateData = { status };
    if (status === 'ONGOING') updateData.startTime = new Date();
    if (status === 'ENDED' || status === 'MISSED' || status === 'REJECTED') updateData.endTime = new Date();

    const call = await prisma.callSession.update({
      where: { id: callId },
      data: updateData
    });

    try {
      const io = getIO();
      const targetId = call.callerId === req.user.id ? call.receiverId : call.callerId;
      io.to(targetId).emit('call:status', { callId: call.id, status: call.status });
    } catch (err) {
      console.error('[Socket Error] Call status notification failed:', err.message);
    }

    res.status(200).json({ success: true, data: call });
  } catch (error) {
    next(error);
  }
};

const getCallHistory = async (req, res, next) => {
  try {
    const calls = await prisma.callSession.findMany({
      where: {
        OR: [
          { callerId: req.user.id },
          { receiverId: req.user.id }
        ]
      },
      orderBy: { createdAt: 'desc' },
      take: 20
    });
    res.status(200).json({ success: true, data: calls });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  initiateCall,
  updateCallStatus,
  getCallHistory
};
