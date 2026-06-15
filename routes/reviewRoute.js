const express = require('express');
const router = express.Router();

const {
    addReview,
    editReview,
    deleteReview,
    getReviewsByUser,
    getPaymentSetting,
    updatePaymentSetting,
    markAsPaid,
    markAsPaidCustomDate,
    markAsUnpaid,
    markAsUnpaidCustomDate,
    getReviewStats,
    getReviewsForBusiness,
} = require('../controller/reviewsController');

const authMiddleware = require('../middlewares/auth.middleware');
const adminMiddleware = require('../middlewares/admin.middleware');

// ===== USER ROUTES =====
router.post('/', authMiddleware, addReview);
router.get('/payment-setting', authMiddleware, adminMiddleware, getPaymentSetting);
router.patch('/payment-setting', authMiddleware, adminMiddleware, updatePaymentSetting);
router.put('/:id', authMiddleware, editReview);
router.delete('/:id', authMiddleware, deleteReview);
router.get('/business/:businessId', authMiddleware, getReviewsForBusiness);

// ===== ADMIN ROUTES =====
router.get('/user/:userId', authMiddleware, getReviewsByUser);
router.get('/stats/all', authMiddleware, adminMiddleware, getReviewStats);
router.post('/mark-as-paid/:id', authMiddleware, adminMiddleware, markAsPaid);
router.post('/mark-as-paid-custom-date', authMiddleware, adminMiddleware, markAsPaidCustomDate);
router.post('/mark-as-unpaid/:id', authMiddleware, adminMiddleware, markAsUnpaid);
router.post('/mark-as-unpaid-custom-date', authMiddleware, adminMiddleware, markAsUnpaidCustomDate);

module.exports = router;
