const express = require('express');
const router = express.Router();
const multer = require('multer');
const uploadController = require('../controllers/upload.controller');
const { protect } = require('../middlewares/auth.middleware');

const storage = multer.memoryStorage();
const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'audio/mpeg',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/caf',
  'audio/wav',
  'audio/ogg',
  'application/octet-stream'
]);

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!allowedMimeTypes.has(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, WEBP, and PDF files are allowed.'));
    }
    cb(null, true);
  }
});

const acceptFile = upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'image', maxCount: 1 },
  { name: 'document', maxCount: 1 },
  { name: 'proof', maxCount: 1 },
]);

const normalizeFile = (req, res, next) => {
  req.file = req.file || req.files?.file?.[0] || req.files?.image?.[0] || req.files?.document?.[0] || req.files?.proof?.[0];
  next();
};

router.post('/profile', protect, acceptFile, normalizeFile, uploadController.uploadProfileImage);
router.post('/verification', protect, acceptFile, normalizeFile, uploadController.uploadVerificationDoc);
router.post('/payment', protect, acceptFile, normalizeFile, uploadController.uploadPaymentProof);
router.post('/', protect, acceptFile, normalizeFile, uploadController.uploadGeneric);

module.exports = router;
