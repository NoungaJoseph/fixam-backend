const express = require('express');
const router = express.Router();
const callController = require('../controllers/call.controller');
const { protect } = require('../middlewares/auth.middleware');

router.use(protect);

router.post('/initiate', callController.initiateCall);
router.patch('/:callId/status', callController.updateCallStatus);
router.get('/history', callController.getCallHistory);

module.exports = router;
