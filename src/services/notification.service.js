const { admin } = require('../config/firebase');

/**
 * Core function to send push notifications safely
 * @param {string} token - FCM device token
 * @param {object} payload - Notification payload { title, body, data }
 * @returns {Promise<boolean>} Success status
 */
const sendPushNotification = async (token, payload) => {
  if (!admin) {
    console.warn('[Notification] Cannot send push notification: Firebase not initialized.');
    return false;
  }

  if (!token) {
    console.warn('[Notification] Cannot send push notification: No token provided.');
    return false;
  }

  try {
    const message = {
      token,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data || {},
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'default_channel_id',
        },
      },
    };

    const response = await admin.messaging().send(message);
    console.log(`[Notification] Successfully sent message: ${response}`);
    return true;
  } catch (error) {
    console.error('[Notification] Error sending push notification:', error.message);
    // Don't throw to prevent backend crashes
    return false;
  }
};

/**
 * Send notification to multiple tokens
 */
const sendMulticastNotification = async (tokens, payload) => {
  if (!admin) return false;
  if (!tokens || tokens.length === 0) return false;

  try {
    const message = {
      tokens,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data || {},
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`[Notification] Multicast sent. Success count: ${response.successCount}, Failure count: ${response.failureCount}`);
    return true;
  } catch (error) {
    console.error('[Notification] Error sending multicast:', error.message);
    return false;
  }
};

// Specialized Helpers

const sendChatNotification = async (token, senderName, messageContent, conversationId) => {
  return sendPushNotification(token, {
    title: `New message from ${senderName}`,
    body: messageContent.length > 50 ? `${messageContent.substring(0, 47)}...` : messageContent,
    data: {
      type: 'CHAT',
      conversationId: conversationId,
    }
  });
};

const sendBookingNotification = async (token, title, description, bookingId) => {
  return sendPushNotification(token, {
    title,
    body: description,
    data: {
      type: 'BOOKING',
      bookingId: bookingId,
    }
  });
};

const sendAdminNotification = async (token, title, body) => {
  return sendPushNotification(token, {
    title: `Admin: ${title}`,
    body,
    data: {
      type: 'ADMIN',
    }
  });
};

const sendCallNotification = async (token, callerName, type, sessionId) => {
  return sendPushNotification(token, {
    title: `Incoming ${type} Call`,
    body: `${callerName} is calling you`,
    data: {
      type: 'CALL',
      callType: type,
      sessionId: sessionId,
    }
  });
};

module.exports = {
  sendPushNotification,
  sendMulticastNotification,
  sendChatNotification,
  sendBookingNotification,
  sendAdminNotification,
  sendCallNotification
};
