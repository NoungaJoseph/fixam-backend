const express = require('express');
const router = express.Router();
const agreementController = require('../controllers/agreement.controller');
const { protect } = require('../middlewares/auth.middleware');

router.use(protect);

router.get('/history', agreementController.getAgreementHistory);
router.get('/:id', agreementController.getAgreementById);
router.get('/:id/pdf', agreementController.downloadAgreementPdf);
router.post('/:id/accept', agreementController.acceptAgreement);

module.exports = router;
