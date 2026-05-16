const express = require('express');
const router = express.Router();
const multer = require('multer');
const uploadController = require('../controllers/upload.controller');
const { protect } = require('../middlewares/auth.middleware');

const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }
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
