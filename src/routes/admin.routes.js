const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admin.controller');
const disputeController = require('../controllers/dispute.controller');
const agreementController = require('../controllers/agreement.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

router.use(protect, authorize('ADMIN'));

router.get('/stats', adminController.getDashboardStats);
router.get('/analytics', adminController.getAnalytics);
router.get('/financial-stats', adminController.getFinancialStats);
router.get('/wallet/stats', adminController.getWalletStats);
router.get('/broadcasts', adminController.getBroadcasts);
router.get('/users', adminController.getUsers);
router.get('/users/:id', adminController.getUserDetails);
router.get('/providers', adminController.getProviders);
router.get('/verification-documents/:documentId/url', adminController.getVerificationDocumentUrl);
router.get('/pending-transactions', adminController.getPendingTransactions);
router.get('/transactions', adminController.getTransactions);
router.get('/reports', adminController.getReports);
router.get('/feedback', adminController.getFeedback);
router.get('/support-conversations', adminController.getSupportConversations);
router.get('/pending-jobs', adminController.getPendingJobs);
router.get('/approved-jobs', adminController.getApprovedJobs);
router.get('/bookings', adminController.getAllBookings);
router.get('/settings', adminController.getSettings);
router.get('/wallet/wire-history', adminController.getWireHistory);
router.get('/conversations/between/:user1Id/:user2Id', adminController.getConversationBetweenUsers);

// Admin Disputes
router.get('/disputes', disputeController.getAdminDisputes);
router.get('/disputes/:id', disputeController.getDisputeDetails);
router.post('/disputes/:id/request-evidence', disputeController.adminRequestEvidence);
router.post('/disputes/:id/resolve', disputeController.adminResolveDispute);

// Admin Agreements
router.get('/agreements', agreementController.getAdminAgreements);
router.get('/agreements/:id', agreementController.getAgreementById);

// External Job Listings
const externalJobController = require('../controllers/externalJob.controller');
router.get('/external-jobs', externalJobController.getAdminExternalJobs);
router.post('/external-jobs', externalJobController.createExternalJob);
router.get('/external-jobs/settings', externalJobController.getExternalJobSettings);
router.put('/external-jobs/settings', externalJobController.updateExternalJobSettings);
router.get('/external-jobs/applications', externalJobController.getApplicationsLog);
router.get('/external-jobs/:id', externalJobController.getAdminExternalJobById);
router.put('/external-jobs/:id', externalJobController.updateExternalJob);
router.delete('/external-jobs/:id', externalJobController.deleteExternalJob);
router.post('/external-jobs/:id/reverify', externalJobController.reverifyExternalJob);

router.post('/verify-provider', adminController.verifyProvider);
router.post('/approve-transaction', adminController.approveTransaction);
router.post('/messages', adminController.sendAdminMessage);
router.post('/broadcast-email', adminController.sendBroadcastEmail);
router.post('/security-alert', adminController.sendSecurityAlert);
router.put('/users/:id/status', adminController.updateUserStatus);
router.put('/reports/:id/status', adminController.updateReportStatus);
router.put('/feedback/:id/status', adminController.updateFeedbackStatus);
router.put('/jobs/:id/approve', adminController.approveJob);
router.put('/jobs/:id/reject', adminController.rejectJob);
router.put('/settings', adminController.updateSettings);
router.post('/wallet/wire-coins', adminController.wireCoins);

module.exports = router;
