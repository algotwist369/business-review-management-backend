const express = require('express');
const router = express.Router();

const {
    googleAuth,
    signup,
    login,
    logout,
    getCurrentUser,
    updatePassword,
    getAllUsers,
    getUserById,
    updateUserStatus,
    updateUserCredentials,
    deleteUser,
    assignBusinessesToUser,
    assignScopesToUser,
    assignTeamTypeToUser,
    globalSearch,
} = require('../controller/authController');

const authMiddleware = require('../middlewares/auth.middleware');
const adminMiddleware = require('../middlewares/admin.middleware');
const superAdminMiddleware = require('../middlewares/superAdmin.middleware');


// Public
router.post('/google-auth', googleAuth);
router.post('/signup', signup);
router.post('/login', login);
router.post('/logout', authMiddleware, logout);
router.get('/me', authMiddleware, getCurrentUser);
router.patch('/password', authMiddleware, updatePassword);


// Admin
router.get('/search/global', authMiddleware, globalSearch);
router.get('/', authMiddleware, adminMiddleware, getAllUsers);
router.get('/:id', authMiddleware, adminMiddleware, getUserById);
router.patch('/:id/status', authMiddleware, adminMiddleware, updateUserStatus);
router.patch('/:id/credentials', authMiddleware, superAdminMiddleware, updateUserCredentials);
router.delete('/:id', authMiddleware, adminMiddleware, deleteUser);
router.post('/:id/assign-businesses', authMiddleware, adminMiddleware, assignBusinessesToUser);
router.post('/:id/assign-scopes', authMiddleware, adminMiddleware, assignScopesToUser);
router.post('/:id/assign-team-type', authMiddleware, adminMiddleware, assignTeamTypeToUser);

module.exports = router;
