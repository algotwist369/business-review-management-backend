const express = require('express');
const router = express.Router();

const {
    getSocialMediaRecords,
    createOrUpdateSocialMediaRecord
} = require('../controller/socialMediaController');

const authMiddleware = require('../middlewares/auth.middleware');
const { requireScope } = require('../middlewares/scope.middleware');

router.use(authMiddleware);
router.use(requireScope('social_media_management'));

router.get('/', getSocialMediaRecords);
router.post('/', createOrUpdateSocialMediaRecord);

module.exports = router;
