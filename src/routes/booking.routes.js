const express = require('express');
const router = express.Router();
const bookingController = require('../controllers/booking.controller');
const { protect } = require('../middlewares/auth.middleware');

router.use(protect);

router.post('/', bookingController.createBooking);
router.get('/mine', bookingController.getMyBookings);
router.get('/check', bookingController.checkBooking);
router.patch('/:bookingId/status', bookingController.updateBookingStatus);

module.exports = router;
