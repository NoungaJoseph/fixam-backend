const express = require('express');
const router = express.Router();
const reviewController = require('../controllers/review.controller');
const { protect } = require('../middlewares/auth.middleware');

router.post('/', protect, reviewController.createReview);
router.get('/users/:userId', reviewController.getUserReviews);
router.get('/', reviewController.getAllReviews);

module.exports = router;
