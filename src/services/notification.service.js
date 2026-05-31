const admin = require('../config/firebase')
const prisma = require('../config/prisma')

async function sendPushNotification(userId, title, body, data = {}) {
  try {
    // Get user's FCM token
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { fcmToken: true, fullName: true }
    })
    
    if (!user) {
      console.log(`[Push] User ${userId} not found`)
      return { success: false, reason: 'user_not_found' }
    }
    
    if (!user.fcmToken) {
      console.log(`[Push] User ${userId} has no FCM token`)
      return { success: false, reason: 'no_fcm_token' }
    }
    
    // Send via Firebase
    const message = {
      token: user.fcmToken,
      notification: {
        title: title,
        body: body
      },
      data: {
        ...Object.fromEntries(
          Object.entries(data).map(([k, v]) => [k, String(v)])
        )
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          priority: 'high',
          channelId: 'default'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1
          }
        }
      }
    }
    
    const response = await admin.messaging().send(message)
    console.log(`[Push] Sent to ${userId}: ${response}`)
    return { success: true, messageId: response }
    
  } catch (error) {
    // If token is invalid/expired, clear it from DB
    if (
      error.code === 'messaging/invalid-registration-token' ||
      error.code === 'messaging/registration-token-not-registered'
    ) {
      console.log(`[Push] Invalid token for ${userId}, clearing`)
      await prisma.user.update({
        where: { id: userId },
        data: { fcmToken: null }
      }).catch(() => {})
    }
    
    console.error(`[Push] Failed for ${userId}:`, error.message)
    return { success: false, reason: error.message }
  }
}

async function sendPushToMultiple(userIds, title, body, data = {}) {
  const results = await Promise.allSettled(
    userIds.map(userId => 
      sendPushNotification(userId, title, body, data)
    )
  )
  
  const sent = results.filter(
    r => r.status === 'fulfilled' && r.value?.success
  ).length
  
  console.log(`[Push] Batch: ${sent}/${userIds.length} sent`)
  return { sent, total: userIds.length }
}

async function sendMulticastNotification(tokens, payload = {}) {
  try {
    const { title, body, data = {} } = payload;
    if (!tokens || tokens.length === 0) return { success: false, reason: 'no_tokens' };

    const formattedData = {};
    Object.entries(data).forEach(([key, val]) => {
      formattedData[key] = String(val);
    });

    const message = {
      tokens: tokens,
      notification: {
        title: title,
        body: body
      },
      data: formattedData,
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          priority: 'high',
          channelId: 'default'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1
          }
        }
      }
    };

    const response = await admin.messaging().sendEachForMulticast(message);
    console.log(`[Push Multicast] Sent: ${response.successCount}/${tokens.length} successful`);
    
    if (response.failureCount > 0) {
      response.responses.forEach(async (res, idx) => {
        if (!res.success && res.error) {
          const error = res.error;
          if (
            error.code === 'messaging/invalid-registration-token' ||
            error.code === 'messaging/registration-token-not-registered'
          ) {
            const badToken = tokens[idx];
            console.log(`[Push Multicast] Invalid token detected, clearing from database`);
            await prisma.user.updateMany({
              where: { fcmToken: badToken },
              data: { fcmToken: null }
            }).catch(() => {});
          }
        }
      });
    }

    return { success: true, successCount: response.successCount, failureCount: response.failureCount };
  } catch (error) {
    console.error(`[Push Multicast] Failed:`, error.message);
    return { success: false, reason: error.message };
  }
}

async function sendBookingNotification(fcmToken, title, body, bookingId) {
  try {
    if (!fcmToken) {
      console.log(`[Push Booking] No FCM token provided for booking ${bookingId}`)
      return { success: false, reason: 'no_fcm_token' }
    }

    const message = {
      token: fcmToken,
      notification: { title, body },
      data: {
        type: 'BOOKING',
        bookingId: String(bookingId || ''),
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          priority: 'high',
          channelId: 'default'
        }
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1
          }
        }
      }
    }

    const response = await admin.messaging().send(message)
    console.log(`[Push Booking] Sent for booking ${bookingId}: ${response}`)
    return { success: true, messageId: response }
  } catch (error) {
    if (
      error.code === 'messaging/invalid-registration-token' ||
      error.code === 'messaging/registration-token-not-registered'
    ) {
      console.log(`[Push Booking] Invalid token, clearing from database`)
      await prisma.user.updateMany({
        where: { fcmToken },
        data: { fcmToken: null }
      }).catch(() => {})
    }
    console.error(`[Push Booking] Failed for booking ${bookingId}:`, error.message)
    return { success: false, reason: error.message }
  }
}

module.exports = { 
  sendPushNotification, 
  sendPushToMultiple,
  sendMulticastNotification,
  sendBookingNotification
}
