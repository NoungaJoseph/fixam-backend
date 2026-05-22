const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const { protect } = require('../middlewares/auth.middleware');

router.use(protect);

router.get('/conversations', chatController.getConversations);
router.post('/support', chatController.openSupportConversation);
router.get('/:conversationId/active-task', chatController.getActiveTaskForChat);
router.get('/:conversationId/messages', chatController.getMessages);
router.post('/send', chatController.sendMessage);
router.put('/:conversationId/read', chatController.markAsRead);

module.exports = router;
