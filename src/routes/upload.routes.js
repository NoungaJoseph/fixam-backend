const express = require('express');
const router = express.Router();
const multer = require('multer');
const uploadController = require('../controllers/upload.controller');
const { protect } = require('../middlewares/auth.middleware');

const storage = multer.memoryStorage();
const allowedMimeTypes = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/heic',
  'image/heif',
  'image/svg+xml',
  'image/bmp',
  'image/x-icon',
  'application/pdf',
  'audio/mpeg',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/caf',
  'audio/wav',
  'audio/ogg',
  'video/mp4',
  'video/quicktime',
  'video/3gpp',
  'video/webm',
  'video/x-matroska',
  'video/avi',
  'application/octet-stream'
]);

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    if (!allowedMimeTypes.has(file.mimetype) && !file.mimetype.startsWith('video/')) {
      return cb(new Error('File format not supported.'));
    }
    cb(null, true);
  }
});

const acceptFile = upload.fields([
  { name: 'file', maxCount: 10 },
  { name: 'image', maxCount: 10 },
  { name: 'video', maxCount: 10 },
  { name: 'document', maxCount: 5 },
  { name: 'proof', maxCount: 5 },
]);

const normalizeFile = (req, res, next) => {
  req.file = req.file || req.files?.file?.[0] || req.files?.image?.[0] || req.files?.video?.[0] || req.files?.document?.[0] || req.files?.proof?.[0];
  next();
};

router.post('/profile', protect, acceptFile, normalizeFile, uploadController.uploadProfileImage);
router.post('/verification', protect, acceptFile, normalizeFile, uploadController.uploadVerificationDoc);
router.post('/payment', protect, acceptFile, normalizeFile, uploadController.uploadPaymentProof);
router.post('/portfolio', protect, acceptFile, normalizeFile, uploadController.uploadPortfolioMedia);
router.post('/', protect, acceptFile, normalizeFile, uploadController.uploadGeneric);

module.exports = router;
