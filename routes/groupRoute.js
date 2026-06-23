const express = require('express');
const router = express.Router();

const authMiddleware = require('../middlewares/auth.middleware');
const { requireScope } = require('../middlewares/scope.middleware');
const {
    createGroup,
    getUserGroups,
    addBusinessToGroup,
    removeBusinessFromGroup,
    getBusinessesInGroup,
    updateGroupName,
    deleteGroup,
} = require('../controller/groupController');

// Apply auth and scope check to all routes
router.use(authMiddleware);
router.use(requireScope('review_management'));

router.post('/', createGroup);
router.get('/', getUserGroups);
router.get('/:groupId/businesses', getBusinessesInGroup);
router.patch('/:groupId/add-business', addBusinessToGroup);
router.patch('/:groupId/remove-business', removeBusinessFromGroup);
router.patch('/:groupId', updateGroupName);
router.delete('/:groupId', deleteGroup);

module.exports = router;
