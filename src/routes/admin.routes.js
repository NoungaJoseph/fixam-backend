const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

router.use(protect, authorize('ADMIN'));

router.get('/stats', adminController.getDashboardStats);
router.get('/financial-stats', adminController.getFinancialStats);
router.get('/broadcasts', adminController.getBroadcasts);
router.get('/users', adminController.getUsers);
router.get('/users/:id', adminController.getUserDetails);
router.get('/providers', adminController.getProviders);
router.get('/pending-transactions', adminController.getPendingTransactions);
router.get('/reports', adminController.getReports);
router.get('/feedback', adminController.getFeedback);
router.get('/pending-jobs', adminController.getPendingJobs);
router.get('/approved-jobs', adminController.getApprovedJobs);

router.post('/verify-provider', adminController.verifyProvider);
router.post('/approve-transaction', adminController.approveTransaction);
router.post('/messages', adminController.sendAdminMessage);
router.put('/users/:id/status', adminController.updateUserStatus);
router.put('/reports/:id/status', adminController.updateReportStatus);
router.put('/feedback/:id/status', adminController.updateFeedbackStatus);
router.put('/jobs/:id/approve', adminController.approveJob);
router.put('/jobs/:id/reject', adminController.rejectJob);

module.exports = router;
