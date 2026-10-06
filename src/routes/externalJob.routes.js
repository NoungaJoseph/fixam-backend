const express = require('express');
const router = express.Router();
const multer = require('multer');
const externalJobController = require('../controllers/externalJob.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB CV limit
  fileFilter: (req, file, cb) => {
    const allowed = ['pdf', 'doc', 'docx', 'txt', 'rtf', 'png', 'jpg', 'jpeg', 'webp'];
    const ext = (file.originalname || '').split('.').pop().toLowerCase();
    if (
      allowed.includes(ext) ||
      file.mimetype.includes('pdf') ||
      file.mimetype.includes('word') ||
      file.mimetype.includes('document') ||
      file.mimetype.startsWith('image/')
    ) {
      cb(null, true);
    } else {
      cb(new Error('Please upload a PDF, image/photo, or Word document (.pdf, .png, .jpg, .docx) for your CV.'));
    }
  }
});

// ==========================================
// USER-FACING ROUTES
// ==========================================
// Public / authenticated feed of external jobs
router.get('/', externalJobController.getActiveExternalJobs);
router.get('/:id', externalJobController.getExternalJobById);

// Apply via Fixam (One-Tap Apply)
router.post(
  '/:id/apply',
  protect,
  upload.single('cv'),
  externalJobController.applyForExternalJob
);

// Upload or update permanent profile CV
router.post(
  '/user/cv',
  protect,
  upload.single('cv'),
  externalJobController.uploadUserCV
);

// ==========================================
// ADMIN ROUTES
// ==========================================
router.get('/admin/list', protect, authorize('ADMIN'), externalJobController.getAdminExternalJobs);
router.post('/admin/create', protect, authorize('ADMIN'), externalJobController.createExternalJob);
router.get('/admin/settings', protect, authorize('ADMIN'), externalJobController.getExternalJobSettings);
router.put('/admin/settings', protect, authorize('ADMIN'), externalJobController.updateExternalJobSettings);
router.get('/admin/applications', protect, authorize('ADMIN'), externalJobController.getApplicationsLog);
router.get('/admin/:id', protect, authorize('ADMIN'), externalJobController.getAdminExternalJobById);
router.put('/admin/:id', protect, authorize('ADMIN'), externalJobController.updateExternalJob);
router.delete('/admin/:id', protect, authorize('ADMIN'), externalJobController.deleteExternalJob);
router.post('/admin/:id/reverify', protect, authorize('ADMIN'), externalJobController.reverifyExternalJob);

module.exports = router;
