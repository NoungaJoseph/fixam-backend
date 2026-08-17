const express = require('express');
const router = express.Router();
const jobController = require('../controllers/job.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');
const validate = require('../middlewares/validate.middleware');
const { createJobSchema } = require('../validations/job.validation');

router.post('/', protect, authorize('CLIENT', 'PROVIDER'), validate(createJobSchema), jobController.createJob);
router.get('/client', protect, authorize('CLIENT', 'PROVIDER'), jobController.getClientJobs);
router.get('/available', protect, authorize('PROVIDER', 'CLIENT'), jobController.getAvailableJobsForProvider);
router.get('/my-jobs', protect, authorize('PROVIDER', 'CLIENT'), jobController.getProviderJobs);
router.get('/all', protect, authorize('ADMIN'), jobController.getAllJobs);
router.get('/:jobId', protect, jobController.getJobById);
router.get('/popular-categories', protect, jobController.getPopularCategories);
router.post('/:jobId/apply', protect, authorize('PROVIDER', 'CLIENT'), jobController.applyForJob);
router.post('/:jobId/applications/:assignmentId/select', protect, authorize('CLIENT', 'PROVIDER'), jobController.selectProviderForJob);
router.put('/:jobId/status', protect, jobController.updateJobStatus);
router.patch('/:jobId/status', protect, jobController.updateJobStatus);
router.put('/:jobId', protect, authorize('CLIENT', 'PROVIDER', 'ADMIN'), jobController.updateJob);
router.post('/:jobId/materials/propose', protect, authorize('PROVIDER', 'CLIENT'), jobController.proposeDiagnosisMaterials);
router.post('/:jobId/materials/respond', protect, authorize('CLIENT', 'PROVIDER'), jobController.respondToMaterialsProposal);
router.get('/:jobId/agreements', protect, jobController.getAgreementHistory);

module.exports = router;
