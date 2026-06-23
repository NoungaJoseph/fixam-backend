const express = require('express');
const router = express.Router();
const providerController = require('../controllers/provider.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');
const cacheMiddleware = require('../middlewares/cache.middleware');
const validate = require('../middlewares/validate.middleware');
const { updateProviderProfileSchema } = require('../validations/provider.validation');

// Cache public provider lists for 5 minutes
router.get('/', cacheMiddleware(300), providerController.getProviders);
router.get('/top-of-month', cacheMiddleware(300), providerController.getProvidersOfTheMonth);
router.get('/favorites', protect, providerController.getFavoriteProviders);
router.get('/nearby', providerController.getNearbyProviders);
router.get('/:providerId', providerController.getProviderById);
router.post('/:providerId/favorite', protect, providerController.addFavoriteProvider);
router.delete('/:providerId/favorite', protect, providerController.removeFavoriteProvider);
router.put('/status', protect, authorize('PROVIDER'), providerController.updateProviderStatus);
router.post('/status', protect, authorize('PROVIDER'), providerController.updateProviderStatus);
router.put('/profile', protect, authorize('PROVIDER'), validate(updateProviderProfileSchema), providerController.updateProviderProfile);
router.post('/verify', protect, authorize('PROVIDER', 'CLIENT'), providerController.uploadVerificationDocs);

module.exports = router;
