const express = require('express');
const router = express.Router();

const {
    addBusiness,
    getAllBusiness,
    editBusiness,
    deleteBusiness,
    updateBusinessStatus,
} = require('../controller/businessController');

const authMiddleware = require('../middlewares/auth.middleware');
const adminMiddleware = require('../middlewares/admin.middleware');


// Admin Only
router.post('/', authMiddleware, adminMiddleware, addBusiness);
router.get('/', authMiddleware, getAllBusiness);
router.put('/:id', authMiddleware, adminMiddleware, editBusiness);
router.delete('/:id', authMiddleware, adminMiddleware, deleteBusiness);
router.patch('/:id/status', authMiddleware, adminMiddleware, updateBusinessStatus);

module.exports = router;
