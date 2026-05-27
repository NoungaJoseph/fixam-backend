const prisma = require('../config/prisma');

const getSupportConversations = async (req, res, next) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: {
        participants: {
          some: { userId: req.user.id }
        }
      },
      select: {
        id: true,
        lastMessageAt: true,
        createdAt: true,
        participants: {
          select: {
            userId: true,
            unreadCount: true,
            user: {
              select: {
                id: true,
                fullName: true,
                email: true,
                phone: true,
                role: true,
                avatar: true,
                isOnline: true
              }
            }
          }
        },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { id: true, content: true, createdAt: true, type: true }
        }
      },
      orderBy: { lastMessageAt: 'desc' }
    });

    const formatted = conversations
      .map((conversation) => {
        const other = conversation.participants.find((participant) => participant.userId !== req.user.id);
        return {
          id: conversation.id,
          lastMessageAt: conversation.lastMessageAt,
          createdAt: conversation.createdAt,
          user: other?.user,
          unreadCount: conversation.participants.find((participant) => participant.userId === req.user.id)?.unreadCount || 0,
          lastMessage: conversation.messages[0] || null,
          isSupport: true
        };
      })
      .filter((conversation) => conversation.user && conversation.user.role !== 'ADMIN');

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
};
const { getIO } = require('../services/socket.service');
const { sendEmail } = require('../services/email.service');

const verifyProvider = async (req, res, next) => {
  try {
    const { providerId, status, reason } = req.body; // VERIFIED, REJECTED

    const profile = await prisma.providerProfile.update({
      where: { id: providerId },
      data: { verification: status },
      include: { user: true }
    });

    const isVerified = status === 'VERIFIED';
    const title = isVerified ? 'Verification approved' : 'Verification needs attention';
    const body = isVerified
      ? 'Your Fixam professional profile has been verified. You can now receive and accept more jobs.'
      : `We could not approve your verification yet.${reason ? ` Reason: ${reason}` : ' Please submit clearer documents and try again.'}`;

    // Create Notification
    const notification = await prisma.notification.create({
      data: {
        userId: profile.userId,
        title,
        body,
        data: { type: 'VERIFICATION', status, reason }
      }
    });

    if (profile.user.email) {
      sendEmail({
        email: profile.user.email,
        subject: `Fixam - ${title}`,
        message: body,
        html: `
          <div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;border:1px solid #dbeafe;border-radius:16px;overflow:hidden">
            <div style="background:#1E67D1;color:#fff;padding:22px 26px;font-weight:800;font-size:20px">Fixam Verification</div>
            <div style="padding:24px;color:#0D1B2A">
              <h2 style="margin:0 0 10px">${title}</h2>
              <p style="line-height:1.6">${body}</p>
              <p style="font-size:12px;color:#64748b;margin-top:22px">Open the Fixam app to review your verification status.</p>
            </div>
          </div>
        `
      }).catch((err) => console.error('[Email Error] Verification email failed:', err.message));
    }

    // Emit Socket Event
    try {
      const io = getIO();
      io.to(profile.userId).emit('notification:new', notification);
    } catch (err) {
      console.error('[Socket Error] Verification notification failed:', err.message);
    }

    res.status(200).json({ success: true, data: profile });
  } catch (error) {
    next(error);
  }
};

const approveTransaction = async (req, res, next) => {
  try {
    const { transactionId, status } = req.body; // SUCCESS, FAILED
    const allowedStatuses = ['SUCCESS', 'FAILED'];

    if (!transactionId || !allowedStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Transaction ID and a valid status are required' });
    }

    const transaction = await prisma.transaction.findUnique({
      where: { id: transactionId },
      include: { wallet: { include: { user: true } } }
    });

    if (!transaction) {
      return res.status(400).json({ success: false, message: 'Invalid transaction' });
    }

    if (transaction.status !== 'PENDING') {
      if (transaction.status === status) {
        return res.status(200).json({
          success: true,
          data: transaction,
          message: `Transaction already ${status.toLowerCase()}`
        });
      }

      return res.status(400).json({
        success: false,
        message: `Transaction has already been ${transaction.status.toLowerCase()}`
      });
    }

    const updatedTransaction = await prisma.$transaction(async (tx) => {
      const claimed = await tx.transaction.updateMany({
        where: { id: transactionId, status: 'PENDING' },
        data: { status }
      });

      if (!claimed.count) {
        return tx.transaction.findUnique({ where: { id: transactionId } });
      }

      if (status === 'SUCCESS') {
        await tx.wallet.update({
          where: { id: transaction.walletId },
          data: { balance: { increment: transaction.amount } }
        });
      }

      return tx.transaction.findUnique({ where: { id: transactionId } });
    });

    // Create Notification
    const notification = await prisma.notification.upsert({
      where: { id: `${transaction.id}-${status}` },
      update: {},
      create: {
        id: `${transaction.id}-${status}`,
        userId: transaction.wallet.userId,
        title: status === 'SUCCESS' ? 'Payment Approved' : 'Payment Rejected',
        body: status === 'SUCCESS'
          ? `Your purchase of ${transaction.amount} coins was approved. Your wallet balance has been updated.`
          : 'Your coin purchase request was rejected. Please contact support for more details.',
        data: { type: 'TRANSACTION', transactionId: transaction.id, status }
      }
    });

    // Emit Socket Event
    try {
      const io = getIO();
      io.to(transaction.wallet.userId).emit('notification:new', notification);
      
      // Also emit balance update
      if (status === 'SUCCESS') {
        const wallet = await prisma.wallet.findUnique({ where: { id: transaction.walletId } });
        io.to(transaction.wallet.userId).emit('wallet:update', { 
          balance: wallet?.balance ?? transaction.wallet.balance + transaction.amount
        });
      }
    } catch (err) {
      console.error('[Socket Error] Transaction notification failed:', err.message);
    }

    res.status(200).json({ success: true, data: updatedTransaction });
  } catch (error) {
    next(error);
  }
};

const getDashboardStats = async (req, res, next) => {
  try {
    const [userCount, jobCount, completedCount, reportCount, totalRevenue] = await Promise.all([
      prisma.user.count(),
      prisma.job.count(),
      prisma.job.count({ where: { status: 'COMPLETED' } }),
      prisma.report.count(),
      prisma.transaction.aggregate({
        where: { type: 'PURCHASE', status: 'SUCCESS' },
        _sum: { amount: true }
      })
    ]);

    res.status(200).json({
      success: true,
      data: {
        users: userCount,
        jobs: jobCount,
        completed: completedCount,
        reports: reportCount,
        revenue: totalRevenue._sum.amount || 0
      }
    });
  } catch (error) {
    next(error);
  }
};

const getUsers = async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      include: { wallet: true, providerProfile: true },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ success: true, data: users });
  } catch (error) {
    next(error);
  }
};

const getUserDetails = async (req, res, next) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        wallet: { include: { transactions: { orderBy: { createdAt: 'desc' }, take: 25 } } },
        providerProfile: { include: { documents: true } },
        jobsAsClient: { orderBy: { createdAt: 'desc' }, take: 25 },
        notifications: { orderBy: { createdAt: 'desc' }, take: 25 }
      }
    });

    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

const updateUserStatus = async (req, res, next) => {
  try {
    const { isBlocked, reason } = req.body;
    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: {
        isBlocked: Boolean(isBlocked),
        blockedReason: isBlocked ? (reason || 'Blocked by admin') : null,
        blockedAt: isBlocked ? new Date() : null
      },
      include: { wallet: true, providerProfile: true }
    });

    const notification = await prisma.notification.create({
      data: {
        userId: user.id,
        title: isBlocked ? 'Account blocked' : 'Account restored',
        body: isBlocked
          ? `Your Fixam account has been blocked.${reason ? ` Reason: ${reason}` : ''}`
          : 'Your Fixam account has been restored.',
        data: { type: 'ACCOUNT', status: isBlocked ? 'BLOCKED' : 'ACTIVE' }
      }
    });

    try {
      const io = getIO();
      io.to(user.id).emit('notification:new', notification);
    } catch (err) {
      console.error('[Socket Error] User status notification failed:', err.message);
    }

    res.status(200).json({ success: true, data: user });
  } catch (error) {
    next(error);
  }
};

const getProviders = async (req, res, next) => {
  try {
    const providers = await prisma.providerProfile.findMany({
      include: { 
        user: true, 
        documents: true 
      },
      orderBy: { user: { createdAt: 'desc' } }
    });
    res.status(200).json({ success: true, data: providers });
  } catch (error) {
    next(error);
  }
};

const getPendingTransactions = async (req, res, next) => {
  try {
    const transactions = await prisma.transaction.findMany({
      where: { status: 'PENDING' },
      include: { wallet: { include: { user: true } } },
      orderBy: { createdAt: 'desc' }
    });
    res.status(200).json({ success: true, data: transactions });
  } catch (error) {
    next(error);
  }
};

const getTransactions = async (req, res, next) => {
  try {
    const transactions = await prisma.transaction.findMany({
      include: { wallet: { include: { user: true } } },
      orderBy: { createdAt: 'desc' },
      take: 1000
    });
    res.status(200).json({ success: true, data: transactions });
  } catch (error) {
    next(error);
  }
};

const getFinancialStats = async (req, res, next) => {
  try {
    const [payments, activePayments, successCount, pendingCount, failedCount] = await Promise.all([
      prisma.payment.findMany({
        include: {
          user: { select: { id: true, fullName: true, phone: true, email: true, avatar: true } },
          transaction: true
        },
        orderBy: { createdAt: 'asc' },
        take: 1000
      }),
      prisma.payment.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      prisma.payment.count({ where: { status: 'SUCCESS' } }),
      prisma.payment.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }),
      prisma.payment.count({ where: { status: 'FAILED' } })
    ]);

    const successfulPayments = payments.filter((payment) => payment.status === 'SUCCESS');

    const sumPaid = (tx) => {
      return Number(tx.amount || 0);
    };

    const buildBuckets = (mode) => successfulPayments.reduce((acc, tx) => {
      const date = new Date(tx.createdAt);
      let key = date.toISOString().slice(0, 10);
      if (mode === 'weekly') {
        const first = new Date(date);
        first.setDate(date.getDate() - date.getDay());
        key = first.toISOString().slice(0, 10);
      } else if (mode === 'monthly') {
        key = date.toISOString().slice(0, 7);
      }
      if (!acc[key]) acc[key] = { period: key, coins: 0, revenue: 0, count: 0 };
      acc[key].coins += Math.abs(tx.coins || 0);
      acc[key].revenue += sumPaid(tx);
      acc[key].count += 1;
      return acc;
    }, {});

    const methodStats = payments.reduce((acc, payment) => {
      const key = payment.paymentMethod || 'UNKNOWN';
      if (!acc[key]) acc[key] = { method: key, count: 0, revenue: 0, success: 0, failed: 0, pending: 0 };
      acc[key].count += 1;
      if (payment.status === 'SUCCESS') {
        acc[key].success += 1;
        acc[key].revenue += payment.amount;
      } else if (payment.status === 'FAILED') {
        acc[key].failed += 1;
      } else {
        acc[key].pending += 1;
      }
      return acc;
    }, {});

    const totalRevenue = successfulPayments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

    res.status(200).json({
      success: true,
      data: {
        daily: Object.values(buildBuckets('daily')),
        weekly: Object.values(buildBuckets('weekly')),
        monthly: Object.values(buildBuckets('monthly')),
        transactions: payments,
        methodStats: Object.values(methodStats),
        widgets: {
          totalRevenue,
          activePayments,
          successfulTransactions: successCount,
          pendingTransactions: pendingCount,
          failedTransactions: failedCount
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

const getBroadcasts = async (req, res, next) => {
  try {
    const notifications = await prisma.adminMessage.findMany({
      orderBy: { createdAt: 'desc' },
      take: 5
    });
    res.status(200).json({ success: true, data: notifications });
  } catch (error) {
    next(error);
  }
};

const getReports = async (req, res, next) => {
  try {
    const reports = await prisma.report.findMany({
      orderBy: { createdAt: 'desc' }
    });

    const userIds = [...new Set(reports.flatMap((report) => [report.reporterId, report.targetUserId]))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true }
    });
    const usersById = new Map(users.map((user) => [user.id, user]));

    const formatted = reports.map((report) => ({
      ...report,
      reporter: usersById.get(report.reporterId) || null,
      target: usersById.get(report.targetUserId) || null
    }));

    res.status(200).json({ success: true, data: formatted });
  } catch (error) {
    next(error);
  }
};

const updateReportStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const report = await prisma.report.update({
      where: { id: req.params.id },
      data: { status }
    });
    res.status(200).json({ success: true, data: report });
  } catch (error) {
    next(error);
  }
};

const getFeedback = async (req, res, next) => {
  try {
    const feedback = await prisma.feedback.findMany({
      orderBy: { createdAt: 'desc' }
    });

    const userIds = [...new Set(feedback.map((item) => item.userId))];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true, phone: true, email: true, role: true }
    });
    const usersById = new Map(users.map((user) => [user.id, user]));

    res.status(200).json({
      success: true,
      data: feedback.map((item) => ({ ...item, user: usersById.get(item.userId) || null }))
    });
  } catch (error) {
    next(error);
  }
};

const updateFeedbackStatus = async (req, res, next) => {
  try {
    const { status } = req.body;
    const feedback = await prisma.feedback.update({
      where: { id: req.params.id },
      data: { status }
    });
    res.status(200).json({ success: true, data: feedback });
  } catch (error) {
    next(error);
  }
};

const sendAdminMessage = async (req, res, next) => {
  try {
    const { subject, content, recipientId, recipientRole } = req.body;
    if (!subject || !content) {
      return res.status(400).json({ success: false, message: 'Subject and content are required' });
    }

    let recipients = [];
    if (recipientId) {
      recipients = await prisma.user.findMany({ where: { id: recipientId }, select: { id: true, fcmToken: true } });
    } else if (recipientRole && recipientRole !== 'ALL') {
      recipients = await prisma.user.findMany({ where: { role: recipientRole }, select: { id: true, fcmToken: true } });
    } else {
      recipients = await prisma.user.findMany({ where: { role: { not: 'ADMIN' } }, select: { id: true, fcmToken: true } });
    }

    const adminMessage = await prisma.adminMessage.create({
      data: {
        recipientId: recipientId || null,
        recipientRole: recipientRole || 'ALL',
        subject,
        content
      }
    });

    const notifications = await prisma.notification.createMany({
      data: recipients.map((recipient) => ({
        userId: recipient.id,
        title: subject,
        body: content,
        data: { type: 'ADMIN_MESSAGE', adminMessageId: adminMessage.id }
      }))
    });

    try {
      const io = getIO();
      recipients.forEach((recipient) => {
        io.to(recipient.id).emit('notification:new', {
          id: `${adminMessage.id}-${recipient.id}`,
          userId: recipient.id,
          title: subject,
          body: content,
          data: { type: 'ADMIN_MESSAGE', adminMessageId: adminMessage.id },
          isRead: false,
          createdAt: new Date().toISOString()
        });
      });
    } catch (err) {
      console.error('[Socket Error] Admin message broadcast failed:', err.message);
    }

    // Send FCM Push Notification
    const tokens = recipients.map(r => r.fcmToken).filter(Boolean);
    if (tokens.length > 0) {
      const { sendMulticastNotification } = require('../services/notification.service');
      await sendMulticastNotification(tokens, { title: subject, body: content, data: { type: 'ADMIN_MESSAGE', adminMessageId: adminMessage.id } });
    }

    res.status(201).json({ success: true, data: adminMessage, delivered: notifications.count });
  } catch (error) {
    next(error);
  }
};

const getPendingJobs = async (req, res, next) => {
  try {
    const jobs = await prisma.job.findMany({
      where: { approvalStatus: 'PENDING_APPROVAL' },
      include: {
        client: {
          select: { id: true, fullName: true, phone: true, email: true }
        },
        assignments: {
          include: {
            provider: {
              include: { user: { select: { fullName: true, phone: true } } }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ success: true, data: jobs });
  } catch (error) {
    next(error);
  }
};

const getApprovedJobs = async (req, res, next) => {
  try {
    const jobs = await prisma.job.findMany({
      where: { approvalStatus: 'APPROVED' },
      include: {
        client: {
          select: { id: true, fullName: true, phone: true, email: true }
        },
        assignments: {
          include: {
            provider: {
              include: { user: { select: { fullName: true, phone: true } } }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    });

    res.status(200).json({ success: true, data: jobs });
  } catch (error) {
    next(error);
  }
};

const approveJob = async (req, res, next) => {
  try {
    const { id } = req.params;

    const job = await prisma.job.update({
      where: { id },
      data: {
        approvalStatus: 'APPROVED'
      },
      include: {
        client: {
          select: { id: true, fullName: true, email: true }
        }
      }
    });

    // Notify client
    const notification = await prisma.notification.create({
      data: {
        userId: job.clientId,
        title: 'Task Approved',
        body: `Your task "${job.title}" has been approved and is now live for providers to discover!`,
        data: { type: 'JOB', jobId: job.id, status: 'APPROVED' }
      }
    });

    // Emit socket event
    try {
      const { getIO } = require('../services/socket.service');
      const io = getIO();
      io.to(job.clientId).emit('notification:new', notification);
      io.emit('job:approved', job);
    } catch (err) {
      console.error('[Socket Error] Job approval notification failed:', err.message);
    }

    res.status(200).json({ success: true, data: job, message: 'Job approved successfully' });
  } catch (error) {
    next(error);
  }
};

const rejectJob = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ success: false, message: 'Rejection reason is required' });
    }

    const existing = await prisma.job.findUnique({
      where: { id },
      include: {
        assignments: { include: { provider: { include: { user: { include: { wallet: true } } } } } },
        client: { select: { id: true, fullName: true, email: true } }
      }
    });

    if (!existing) {
      return res.status(404).json({ success: false, message: 'Job not found' });
    }

    const job = await prisma.$transaction(async (tx) => {
      const updated = await tx.job.update({
        where: { id },
        data: {
          approvalStatus: 'REJECTED',
          rejectionReason: reason
        },
        include: {
          client: {
            select: { id: true, fullName: true, email: true }
          }
        }
      });

      for (const assignment of existing.assignments) {
        const wallet = assignment.provider.user.wallet;
        if (!wallet || assignment.refundedAt) continue;

        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { increment: existing.coinCost } }
        });
        await tx.transaction.create({
          data: {
            walletId: wallet.id,
            amount: existing.coinCost,
            type: 'REFUND',
            status: 'SUCCESS',
            jobId: existing.id,
            description: `Refund for rejected task: ${existing.title}`
          }
        });
        await tx.jobAssignment.update({
          where: { id: assignment.id },
          data: { refundedAt: new Date(), status: 'REJECTED' }
        });
      }

      return updated;
    });

    // Notify client
    const notification = await prisma.notification.create({
      data: {
        userId: job.clientId,
        title: 'Task Rejected',
        body: `Your task "${job.title}" was not approved. Reason: ${reason}`,
        data: { type: 'JOB', jobId: job.id, status: 'REJECTED', reason }
      }
    });

    // Emit socket event
    try {
      const { getIO } = require('../services/socket.service');
      const io = getIO();
      io.to(job.clientId).emit('notification:new', notification);
    } catch (err) {
      console.error('[Socket Error] Job rejection notification failed:', err.message);
    }

    res.status(200).json({ success: true, data: job, message: 'Job rejected successfully' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  verifyProvider,
  approveTransaction,
  getDashboardStats,
  getUsers,
  getUserDetails,
  updateUserStatus,
  getProviders,
  getPendingTransactions,
  getTransactions,
  getFinancialStats,
  getBroadcasts,
  getReports,
  getSupportConversations,
  updateReportStatus,
  getFeedback,
  updateFeedbackStatus,
  sendAdminMessage,
  getPendingJobs,
  getApprovedJobs,
  approveJob,
  rejectJob
};
