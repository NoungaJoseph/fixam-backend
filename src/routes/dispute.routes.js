const express = require('express');
const router = express.Router();
const disputeController = require('../controllers/dispute.controller');
const { protect } = require('../middlewares/auth.middleware');

router.use(protect);

router.post('/', disputeController.createDispute);
router.get('/', disputeController.getUserDisputes);
router.get('/:id', disputeController.getDisputeDetails);
router.post('/:id/respond', disputeController.respondToDispute);
router.post('/:id/evidence', disputeController.addEvidence);
router.post('/:id/request-correction', disputeController.requestCorrection);
router.post('/:id/complete-correction', disputeController.completeCorrection);

module.exports = router;
