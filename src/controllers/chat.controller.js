const prisma = require('../config/prisma');
const { getIO } = require('../services/socket.service');
const debugLog = (...args) => {
  if (process.env.NODE_ENV !== 'production') console.log(...args);
};

const getConversations = async (req, res, next) => {
  try {
    // Optimized query: Get conversations with minimal nested queries
    const conversations = await prisma.conversation.findMany({
      where: {
        participants: { some: { userId: req.user.id } }
      },
      select: {
        id: true,
        lastMessageAt: true,
        createdAt: true,
        updatedAt: true,
        participants: {
          select: {
            userId: true,
            unreadCount: true,
            user: {
              select: { 
                id: true, 
                fullName: true, 
                avatar: true, 
                isOnline: true, 
                role: true,
                providerProfile: {
                  select: { profileMode: true }
                }
              }
            }
          }
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, content: true, createdAt: true, type: true, deliveredAt: true, readAt: true, isRead: true }
        }
      },
      orderBy: { lastMessageAt: 'desc' }
    });
    
    // Format response — omit activeTask here (loaded when opening a chat via GET /chat/:id/active-task)
    // so this endpoint stays fast at scale instead of N+1 job lookups per conversation.
    const formatted = conversations.map((conv) => ({
      id: conv.id,
      lastMessageAt: conv.lastMessageAt,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
      participants: conv.participants.filter(p => p.userId !== req.user.id).map(p => p.user),
      lastMessage: conv.messages[0] || null,
      unreadCount: conv.participants.find(p => p.userId === req.user.id)?.unreadCount || 0,
      activeTask: null,
    }));

    debugLog('[Chat] getConversations returned', formatted.length, 'conversations (no per-row task lookup)');
    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
};

const findActiveTaskBetweenUsers = async (currentUserId, otherUserId) => {
  return prisma.job.findFirst({
    where: {
      status: { in: ['ASSIGNED', 'IN_PROGRESS'] },
      OR: [
        {
          clientId: currentUserId,
          assignments: {
            some: {
              status: 'ACCEPTED',
              provider: { userId: otherUserId }
            }
          }
        },
        {
          clientId: otherUserId,
          assignments: {
            some: {
              status: 'ACCEPTED',
              provider: { userId: currentUserId }
            }
          }
        }
      ]
    },
    include: {
      client: { select: { id: true, fullName: true, avatar: true } },
      assignments: {
        include: {
          provider: {
            include: {
              user: { select: { id: true, fullName: true, avatar: true } }
            }
          }
        }
      }
    },
    orderBy: { updatedAt: 'desc' }
  });
};

const openSupportConversation = async (req, res, next) => {
  try {
    const admin = await prisma.user.findFirst({
      where: { role: 'ADMIN' },
      select: { id: true, fullName: true, avatar: true, isOnline: true, role: true }
    });

    if (!admin) {
      return res.status(404).json({ success: false, message: 'Support is not available yet.' });
    }

    const existing = await prisma.$queryRaw`
      SELECT c.id FROM "Conversation" c
      INNER JOIN "ConversationParticipant" cp1 ON c.id = cp1."conversationId" AND cp1."userId" = ${req.user.id}
      INNER JOIN "ConversationParticipant" cp2 ON c.id = cp2."conversationId" AND cp2."userId" = ${admin.id}
      LIMIT 1
    `;

    const conversationId = existing?.[0]?.id || (await prisma.conversation.create({
      data: {
        participants: {
          create: [
            { userId: req.user.id },
            { userId: admin.id }
          ]
        }
      },
      select: { id: true }
    })).id;

    await prisma.supportConversation.upsert({
      where: { conversationId },
      update: { status: 'OPEN', assignedAdminId: admin.id },
      create: {
        conversationId,
        userId: req.user.id,
        assignedAdminId: admin.id,
        status: 'OPEN'
      }
    });

    res.status(200).json({
      success: true,
      data: {
        id: conversationId,
        participants: [{ ...admin, fullName: admin.fullName || 'Fixam Support' }],
        isSystem: true,
        unreadCount: 0
      }
    });
  } catch (error) {
    next(error);
  }
};

const getActiveTaskForChat = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    const conversation = await prisma.conversation.findFirst({
      where: {
        id: conversationId,
        participants: { some: { userId: req.user.id } }
      },
      select: {
        participants: { select: { userId: true } }
      }
    });

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }

    const otherUserId = conversation.participants.find((participant) => participant.userId !== req.user.id)?.userId;
    const activeTask = otherUserId ? await findActiveTaskBetweenUsers(req.user.id, otherUserId) : null;
    res.status(200).json({ success: true, data: activeTask });
  } catch (error) {
    next(error);
  }
};

const getMessages = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    
    // Quick check: User is participant (single efficient query)
    const isParticipant = await prisma.conversationParticipant.findUnique({
      where: {
        conversationId_userId: {
          conversationId,
          userId: req.user.id
        }
      },
      select: { id: true }
    });
    
    if (!isParticipant) {
      return res.status(404).json({ success: false, message: 'Conversation not found' });
    }
    
    const limit = Math.min(parseInt(req.query.limit, 10) || 100, 200);

    // Fetch the latest messages, then return them oldest -> newest for display.
    const latestMessages = await prisma.message.findMany({
      where: { conversationId },
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        content: true,
        mediaUrl: true,
        type: true,
        deliveredAt: true,
        readAt: true,
        isRead: true,
        createdAt: true,
        sender: {
          select: { id: true, fullName: true, avatar: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
    const messages = latestMessages.reverse();

    // Mark as read in same query batch
    await prisma.conversationParticipant.update({
      where: {
        conversationId_userId: {
          conversationId,
          userId: req.user.id
        }
      },
      data: { unreadCount: 0 }
    });

    debugLog('[Chat] getMessages fetched', messages.length, 'messages for conv:', conversationId);
    res.status(200).json({ success: true, data: messages });
  } catch (error) {
    console.error('[Chat] Error in getMessages:', error.message);
    next(error);
  }
};

const sendMessage = async (req, res, next) => {
  try {
    const { conversationId, content, type, receiverId, clientMessageId } = req.body;
    debugLog('[Chat] sendMessage:', { userId: req.user.id, conversationId, receiverId, contentLength: content?.length, type });
    let actualConvId = conversationId;

    // 1. Create conversation if it doesn't exist (for new chats)
    if (!actualConvId && receiverId) {
      // Use raw SQL for faster query (single db hit vs nested queries)
      const existing = await prisma.$queryRaw`
        SELECT c.id FROM "Conversation" c
        INNER JOIN "ConversationParticipant" cp1 ON c.id = cp1."conversationId" AND cp1."userId" = ${req.user.id}
        INNER JOIN "ConversationParticipant" cp2 ON c.id = cp2."conversationId" AND cp2."userId" = ${receiverId}
        LIMIT 1
      `;

      if (existing && existing.length > 0) {
        actualConvId = existing[0].id;
        debugLog('[Chat] Found existing conversation:', actualConvId);
      } else {
        const newConv = await prisma.conversation.create({
          data: {
            participants: {
              create: [
                { userId: req.user.id },
                { userId: receiverId }
              ]
            }
          },
          select: { id: true }
        });
        actualConvId = newConv.id;
        debugLog('[Chat] Created new conversation:', actualConvId);
      }
    }

    // 2. Save Message
    if (!actualConvId) {
      return res.status(400).json({ success: false, message: 'Recipient ID or Conversation ID is required' });
    }

    const message = await prisma.message.create({
      data: {
        conversationId: actualConvId,
        senderId: req.user.id,
        content,
        mediaUrl: type && type !== 'TEXT' ? content : null,
        type: type || 'TEXT',
        deliveredAt: new Date()
      },
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        content: true,
        mediaUrl: true,
        type: true,
        deliveredAt: true,
        readAt: true,
        isRead: true,
        createdAt: true,
        sender: {
          select: { id: true, fullName: true, avatar: true }
        }
      }
    });

    // 3. Update Conversation timestamp and Unread counts (batch these together)
    await Promise.all([
      prisma.conversation.update({
        where: { id: actualConvId },
        data: { lastMessageAt: new Date() }
      }),
      prisma.conversationParticipant.updateMany({
        where: { conversationId: actualConvId, NOT: { userId: req.user.id } },
        data: { unreadCount: { increment: 1 } }
      }),
      prisma.supportConversation.updateMany({
        where: { conversationId: actualConvId },
        data: { status: 'WAITING' }
      })
    ]);

    const outgoingMessage = clientMessageId ? { ...message, clientMessageId } : message;

    // 4. Emit via Socket.io (Wrap in try-catch to prevent crashes)
    try {
      const io = getIO();
      
      // Emit to conversation room (for users already in the room)
      io.to(actualConvId).emit('message:new', outgoingMessage);
      
      // Also emit directly to receiver by userId (in case they're not in room)
      if (receiverId) {
        io.to(receiverId).emit('message:new', outgoingMessage);
        io.to(receiverId).emit('notification:chat', { 
          title: 'New Message', 
          body: content, 
          conversationId: actualConvId,
          senderId: req.user.id
        });

        // Send FCM Push Notification
        const receiver = await prisma.user.findUnique({ where: { id: receiverId }, select: { fcmToken: true } });
        if (receiver && receiver.fcmToken) {
          const { sendChatNotification } = require('../services/notification.service');
          await sendChatNotification(receiver.fcmToken, req.user.fullName || req.user.phone || 'Someone', content, actualConvId);
        }
      }
      
      debugLog('[Chat] Socket events emitted - ConvId room:', actualConvId, '| Receiver:', receiverId);
    } catch (socketErr) {
      console.error('[Socket Error] Failed to emit message:', socketErr.message);
    }

    res.status(201).json({ success: true, data: outgoingMessage });
  } catch (error) {
    next(error);
  }
};

const markAsRead = async (req, res, next) => {
  try {
    const { conversationId } = req.params;
    
    // Use updateMany to avoid error if participant doesn't exist
    await prisma.conversationParticipant.updateMany({
      where: { 
        conversationId: conversationId, 
        userId: req.user.id 
      },
      data: { unreadCount: 0 }
    });
    await prisma.message.updateMany({
      where: { conversationId, senderId: { not: req.user.id }, readAt: null },
      data: { isRead: true, readAt: new Date() }
    });
    await prisma.supportConversation.updateMany({
      where: { conversationId, OR: [{ userId: req.user.id }, { assignedAdminId: req.user.id }] },
      data: { lastReadAt: new Date() }
    });
    
    res.status(200).json({ success: true });
  } catch (error) {
    // Log but don't fail the request
    debugLog('Error marking as read:', error.message);
    res.status(200).json({ success: true });
  }
};

module.exports = {
  getConversations,
  openSupportConversation,
  getActiveTaskForChat,
  getMessages,
  sendMessage,
  markAsRead
};
