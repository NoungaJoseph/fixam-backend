const express = require('express');
const router = express.Router();
const providerController = require('../controllers/provider.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');
const cacheMiddleware = require('../middlewares/cache.middleware');
const validate = require('../middlewares/validate.middleware');
const { updateProviderProfileSchema } = require('../validations/provider.validation');

// Report routes
router.get('/reports/all', protect, authorize('PROVIDER'), providerController.getProviderReports);
router.post('/reports/generate', protect, authorize('PROVIDER'), providerController.generateProviderReport);

// Cache public provider lists for 5 minutes
router.get('/', cacheMiddleware(300), providerController.getProviders);
router.get('/top-of-month', cacheMiddleware(300), providerController.getProvidersOfTheMonth);
router.get('/favorites', protect, providerController.getFavoriteProviders);
router.get('/nearby', providerController.getNearbyProviders);
router.post('/boost', protect, authorize('PROVIDER'), providerController.boostProviderProfile);
router.post('/claim-setup-bonus', protect, authorize('PROVIDER'), providerController.claimSetupBonus);
router.put('/status', protect, authorize('PROVIDER'), providerController.updateProviderStatus);
router.post('/status', protect, authorize('PROVIDER'), providerController.updateProviderStatus);
router.put('/profile', protect, authorize('PROVIDER'), validate(updateProviderProfileSchema), providerController.updateProviderProfile);
router.post('/verify', protect, authorize('PROVIDER', 'CLIENT'), providerController.uploadVerificationDocs);

router.get('/:providerId', protect, providerController.getProviderById);
router.post('/:providerId/unlock', protect, authorize('CLIENT'), providerController.unlockProviderProfile);
router.post('/:providerId/favorite', protect, providerController.addFavoriteProvider);
router.delete('/:providerId/favorite', protect, providerController.removeFavoriteProvider);

module.exports = router;
