const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

if (!admin.apps.length) {
  try {
    let credentialCert = null;

    // 1. Try individual env variables
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      credentialCert = admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n')
      });
      console.log('[Firebase] Initialized via individual environment variables');
    }
    // 2. Try JSON service account string (Railway/Production)
    else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      try {
        const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
        if (serviceAccount.private_key) {
          serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
        }
        credentialCert = admin.credential.cert(serviceAccount);
        console.log('[Firebase] Initialized via FIREBASE_SERVICE_ACCOUNT env variable');
      } catch (jsonErr) {
        console.error('[Firebase] Failed to parse FIREBASE_SERVICE_ACCOUNT env variable:', jsonErr.message);
      }
    }
    // 3. Fallback to local file for development
    else {
      const serviceAccountPath = path.resolve(__dirname, 'firebase-service-account.json');
      if (fs.existsSync(serviceAccountPath)) {
        const serviceAccount = require(serviceAccountPath);
        if (serviceAccount.private_key) {
          serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
        }
        credentialCert = admin.credential.cert(serviceAccount);
        console.log('[Firebase] Initialized via local firebase-service-account.json');
      }
    }

    if (credentialCert) {
      admin.initializeApp({
        credential: credentialCert
      });
      console.log('[Firebase] Admin SDK initialized successfully');
    } else {
      console.warn('[Firebase] Warning: No Firebase credentials found. Push notifications will be disabled.');
    }
  } catch (error) {
    console.error('[Firebase] Failed to initialize:', error.message);
  }
}

module.exports = admin;

