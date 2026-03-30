const express = require('express');
const router = express.Router();

const {
    googleAuth,
    logout,
    getAllUsers,
    getUserById,
    updateUserStatus,
    deleteUser,
    assignBusinessesToUser,
} = require('../controller/authController');

const authMiddleware = require('../middlewares/auth.middleware');
const adminMiddleware = require('../middlewares/admin.middleware');


// Public
router.post('/google-auth', googleAuth);
router.post('/logout', authMiddleware, logout);


// Admin
router.get('/', authMiddleware, adminMiddleware, getAllUsers);
router.get('/:id', authMiddleware, adminMiddleware, getUserById);
router.patch('/:id/status', authMiddleware, adminMiddleware, updateUserStatus);
router.delete('/:id', authMiddleware, adminMiddleware, deleteUser);
router.post('/:id/assign-businesses', authMiddleware, adminMiddleware, assignBusinessesToUser);

module.exports = router;
