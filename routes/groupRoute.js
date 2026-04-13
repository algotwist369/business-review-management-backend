const express = require('express');
const router = express.Router();

const authMiddleware = require('../middlewares/auth.middleware');
const {
    createGroup,
    getUserGroups,
    addBusinessToGroup,
    removeBusinessFromGroup,
    getBusinessesInGroup,
} = require('../controller/groupController');

router.post('/', authMiddleware, createGroup);
router.get('/', authMiddleware, getUserGroups);
router.get('/:groupId/businesses', authMiddleware, getBusinessesInGroup);
router.patch('/:groupId/add-business', authMiddleware, addBusinessToGroup);
router.patch('/:groupId/remove-business', authMiddleware, removeBusinessFromGroup);

module.exports = router;
