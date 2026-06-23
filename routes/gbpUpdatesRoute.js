const express = require('express');
const router = express.Router();

const {
    createGbpUpdate,
    updateGbpUpdate,
    getGbpUpdates,
    getGbpUpdateById,
    getGbpUpdatesByBusiness,
    getGbpUpdatesSummary,
    deleteGbpUpdate
} = require('../controller/gbpUpdatesController');

const authMiddleware = require('../middlewares/auth.middleware');
const { requireScope } = require('../middlewares/scope.middleware');

// Apply auth and scope check to all routes
router.use(authMiddleware);
router.use(requireScope('social_media_management'));

// Define routes
router.get('/', getGbpUpdates);
router.get('/summary', getGbpUpdatesSummary);
router.get('/business/:businessId', getGbpUpdatesByBusiness);
router.get('/:id', getGbpUpdateById);
router.post('/', createGbpUpdate);
router.put('/:id', updateGbpUpdate);
router.delete('/:id', deleteGbpUpdate);

module.exports = router;
