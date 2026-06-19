const express = require('express');
const router = express.Router();
const providerController = require('../controllers/provider.controller');
const { protect, authorize } = require('../middlewares/auth.middleware');

router.get('/', providerController.getProviders);
router.get('/top-of-month', providerController.getProvidersOfTheMonth);
router.get('/favorites', protect, providerController.getFavoriteProviders);
router.get('/nearby', providerController.getNearbyProviders);
router.get('/:providerId', providerController.getProviderById);
router.post('/:providerId/favorite', protect, providerController.addFavoriteProvider);
router.delete('/:providerId/favorite', protect, providerController.removeFavoriteProvider);
router.put('/status', protect, authorize('PROVIDER'), providerController.updateProviderStatus);
router.post('/status', protect, authorize('PROVIDER'), providerController.updateProviderStatus);
router.put('/profile', protect, authorize('PROVIDER'), providerController.updateProviderProfile);
router.post('/verify', protect, authorize('PROVIDER', 'CLIENT'), providerController.uploadVerificationDocs);

module.exports = router;
