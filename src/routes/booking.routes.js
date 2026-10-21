const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/booking.controller');
const validate = require('../middlewares/validate.middleware');
const { createBookingSchema, updateBookingStatusSchema, counterBookingSchema, createBookingRevisionSchema } = require('../validations/booking.validation');
const { protect } = require('../middlewares/auth.middleware');
const idempotencyMiddleware = require('../middlewares/idempotency.middleware');

router.use(protect);

router.post('/', validate(createBookingSchema), idempotencyMiddleware, bookingController.createBooking);
router.get('/mine', bookingController.getMyBookings);
router.get('/check', bookingController.checkBooking);
router.get('/:bookingId', bookingController.getBookingById);
router.patch('/:bookingId/status', validate(updateBookingStatusSchema), bookingController.updateBookingStatus);
router.post('/:bookingId/counter', validate(counterBookingSchema), bookingController.counterBooking);
router.get('/:bookingId/revisions', bookingController.getBookingRevisions);
router.post('/:bookingId/revisions', validate(createBookingRevisionSchema), bookingController.createBookingRevision);
router.post('/:bookingId/revisions/:revisionId/accept', bookingController.acceptBookingRevision);
router.post('/:bookingId/revisions/:revisionId/decline', bookingController.declineBookingRevision);
router.post('/:bookingId/request-review', bookingController.requestReview);
router.post('/:bookingId/materials/propose', bookingController.proposeDiagnosisMaterials);
router.post('/:bookingId/materials/respond', bookingController.respondToMaterialsProposal);
router.get('/:bookingId/agreements', bookingController.getAgreementHistory);
router.get('/:bookingId/contract-pdf', bookingController.downloadContractPdf);

module.exports = router;
