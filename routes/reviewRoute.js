const express = require('express');
const router = express.Router();

const {
    addReview,
    editReview,
    deleteReview,
    getReviewsByUser,
    markAsPaid,
    markAsPaidCustomDate,
    getReviewStats,
} = require('../controller/reviewsController');

const authMiddleware = require('../middlewares/auth.middleware');
const adminMiddleware = require('../middlewares/admin.middleware');

// ===== USER ROUTES =====
router.post('/', authMiddleware, addReview);
router.put('/:id', authMiddleware, editReview);
router.delete('/:id', authMiddleware, deleteReview);

// ===== ADMIN ROUTES =====
router.get('/user/:userId', authMiddleware, getReviewsByUser);
router.get('/stats/all', authMiddleware, adminMiddleware, getReviewStats);
router.post('/mark-as-paid/:id', authMiddleware, adminMiddleware, markAsPaid);
router.post('/mark-as-paid-custom-date', authMiddleware, adminMiddleware, markAsPaidCustomDate);

module.exports = router;
