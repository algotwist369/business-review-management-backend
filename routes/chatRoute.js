const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const {
    getContacts,
    getMessages,
    sendMessage,
    markChatAsRead,
    getGroupCandidates,
    createGroup,
    getGroups,
    getGroupMessages,
    sendGroupMessage,
    editGroup,
    deleteGroup
} = require('../controller/chatController');

// All chat routes require user authentication
router.use(authMiddleware);

router.get('/contacts', getContacts);
router.get('/messages/:contactId', getMessages);
router.post('/messages', sendMessage);
router.patch('/messages/:contactId/read', markChatAsRead);

// Group Chat Routes
router.get('/group-candidates', getGroupCandidates);
router.post('/groups', createGroup);
router.get('/groups', getGroups);
router.get('/groups/:groupId/messages', getGroupMessages);
router.post('/groups/messages', sendGroupMessage);
router.put('/groups/:groupId', editGroup);
router.delete('/groups/:groupId', deleteGroup);

module.exports = router;
