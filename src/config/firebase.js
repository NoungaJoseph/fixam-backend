const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const initFirebase = () => {
  try {
    if (admin.apps.length > 0) return admin;

    let serviceAccount;
    
    // Support Railway environment variable approach first (most secure for deployment)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        console.log('[Firebase] Initialized via FIREBASE_SERVICE_ACCOUNT env variable');
      } catch (err) {
        console.error('[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT env variable:', err.message);
      }
    }

    // Fallback to local file for development
    if (!serviceAccount) {
      const serviceAccountPath = path.resolve(__dirname, 'firebase-service-account.json');
      if (fs.existsSync(serviceAccountPath)) {
        serviceAccount = require(serviceAccountPath);
        console.log('[Firebase] Initialized via local firebase-service-account.json');
      }
    }

    if (!serviceAccount) {
      console.warn('[Firebase] Warning: No service account found. Push notifications will be disabled.');
      return null;
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });

    console.log('[Firebase] Admin SDK initialized successfully');
    return admin;
  } catch (error) {
    console.error('[Firebase] Initialization error:', error.message);
    return null; // Return null so backend does not crash
  }
};

const adminInstance = initFirebase();

module.exports = { admin: adminInstance };
