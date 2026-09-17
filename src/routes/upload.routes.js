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
  'image/bmp',
  'image/x-icon',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
  'application/zip',
  'application/x-zip-compressed',
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
]);

const allowedExtensions = new Set([
  'jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'heif', 'bmp',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv', 'zip',
  'mp3', 'm4a', 'wav', 'ogg', 'caf',
  'mp4', 'mov', '3gp', 'webm', 'mkv', 'avi'
]);

const upload = multer({
  storage,
  limits: { fileSize: 100 * 1024 * 1024 }, // 100MB limit
  fileFilter: (req, file, cb) => {
    const mime = (file.mimetype || '').toLowerCase();
    const ext = (file.originalname || '').split('.').pop().toLowerCase();

    if (
      allowedMimeTypes.has(mime) ||
      mime.startsWith('image/') ||
      mime.startsWith('video/') ||
      mime.startsWith('audio/') ||
      (mime === 'application/octet-stream' && allowedExtensions.has(ext))
    ) {
      return cb(null, true);
    }
    return cb(new Error('File format not supported.'));
  }
});

const acceptFile = upload.fields([
  { name: 'file', maxCount: 10 },
  { name: 'image', maxCount: 10 },
  { name: 'video', maxCount: 10 },
  { name: 'document', maxCount: 5 },
  { name: 'proof', maxCount: 5 },
  { name: 'avatar', maxCount: 2 },
  { name: 'photo', maxCount: 5 },
  { name: 'media', maxCount: 10 },
  { name: 'attachment', maxCount: 5 },
]);

const normalizeFile = (req, res, next) => {
  req.file = req.file ||
    req.files?.file?.[0] ||
    req.files?.avatar?.[0] ||
    req.files?.photo?.[0] ||
    req.files?.image?.[0] ||
    req.files?.video?.[0] ||
    req.files?.document?.[0] ||
    req.files?.attachment?.[0] ||
    req.files?.media?.[0] ||
    req.files?.proof?.[0];
  next();
};

router.post('/profile', protect, acceptFile, normalizeFile, uploadController.uploadProfileImage);
router.post('/verification', protect, acceptFile, normalizeFile, uploadController.uploadVerificationDoc);
router.post('/payment', protect, acceptFile, normalizeFile, uploadController.uploadPaymentProof);
router.post('/portfolio', protect, acceptFile, normalizeFile, uploadController.uploadPortfolioMedia);
router.post('/proposal', protect, acceptFile, normalizeFile, uploadController.uploadProposalMedia);
router.post('/', protect, acceptFile, normalizeFile, uploadController.uploadGeneric);

module.exports = router;
