const express = require('express');
const router = express.Router();

const {
    getGoogleAdsRecords,
    createOrUpdateGoogleAdsRecord
} = require('../controller/googleAdsController');

const authMiddleware = require('../middlewares/auth.middleware');
const { requireScope } = require('../middlewares/scope.middleware');

router.use(authMiddleware);
router.use(requireScope('gbp_record_management'));

router.get('/', getGoogleAdsRecords);
router.post('/', createOrUpdateGoogleAdsRecord);

module.exports = router;
