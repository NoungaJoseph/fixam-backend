const express = require('express');
const router = express.Router();
const webAuthController = require('../../controllers/web/web-auth.controller');

router.post('/login', webAuthController.login);
router.post('/signup', webAuthController.signup);
router.post('/check-email', webAuthController.checkEmail);

module.exports = router;
