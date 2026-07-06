const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');

const {
    getBusinessOptions,
    getCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    getIssueTypes,
    createIssueType,
    updateIssueType,
    deleteIssueType,
    getTickets,
    getTicketById,
    createTicket,
    addRemark,
    updateTicketStatus,
    updateTicketPriority,
    getAccessList,
    getMyAccess,
    updateAccess,
} = require('../controller/supportController');

router.use(authMiddleware);

router.get('/business-options', getBusinessOptions);
router.get('/my-access', getMyAccess);

router.get('/categories', getCategories);
router.post('/categories', createCategory);
router.put('/categories/:id', updateCategory);
router.delete('/categories/:id', deleteCategory);

router.get('/issue-types', getIssueTypes);
router.post('/issue-types', createIssueType);
router.put('/issue-types/:id', updateIssueType);
router.delete('/issue-types/:id', deleteIssueType);

router.get('/tickets', getTickets);
router.post('/tickets', createTicket);
router.get('/tickets/:id', getTicketById);
router.post('/tickets/:id/remarks', addRemark);
router.patch('/tickets/:id/status', updateTicketStatus);
router.patch('/tickets/:id/priority', updateTicketPriority);

router.get('/access', getAccessList);
router.post('/access/:userId', updateAccess);

module.exports = router;
