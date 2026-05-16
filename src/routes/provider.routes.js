const express = require('express');
const router = express.Router();
const providerController = require('../controllers/provider.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

router.get('/', providerController.getProviders);
router.get('/nearby', providerController.getNearbyProviders);
router.put('/status', protect, authorize('PROVIDER'), providerController.updateProviderStatus);
router.post('/status', protect, authorize('PROVIDER'), providerController.updateProviderStatus);
router.put('/profile', protect, authorize('PROVIDER'), providerController.updateProviderProfile);
router.post('/verify', protect, authorize('PROVIDER'), providerController.uploadVerificationDocs);

module.exports = router;
