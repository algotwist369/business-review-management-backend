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
const { requireScope } = require('../middlewares/scope.middleware');

// Apply auth and scope check to all routes
router.use(authMiddleware);
router.use(requireScope('review_management'));

// ===== USER ROUTES =====
router.post('/', addReview);
router.get('/payment-setting', adminMiddleware, getPaymentSetting);
router.patch('/payment-setting', adminMiddleware, updatePaymentSetting);
router.put('/:id', editReview);
router.delete('/:id', deleteReview);
router.get('/business/:businessId', getReviewsForBusiness);

// ===== ADMIN ROUTES =====
router.get('/user/:userId', getReviewsByUser);
router.get('/stats/all', adminMiddleware, getReviewStats);
router.post('/mark-as-paid/:id', adminMiddleware, markAsPaid);
router.post('/mark-as-paid-custom-date', adminMiddleware, markAsPaidCustomDate);
router.post('/mark-as-unpaid/:id', adminMiddleware, markAsUnpaid);
router.post('/mark-as-unpaid-custom-date', adminMiddleware, markAsUnpaidCustomDate);

module.exports = router;
