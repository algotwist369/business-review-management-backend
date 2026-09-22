const express = require('express');
const router = express.Router();

const {
    getCanvaRecords,
    createOrUpdateCanvaRecord
} = require('../controller/canvaController');

const authMiddleware = require('../middlewares/auth.middleware');
const { requireScope } = require('../middlewares/scope.middleware');

router.use(authMiddleware);
router.use(requireScope('social_media_management'));

router.get('/', getCanvaRecords);
router.post('/', createOrUpdateCanvaRecord);

module.exports = router;
