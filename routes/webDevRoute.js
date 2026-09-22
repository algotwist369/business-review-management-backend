const express = require('express');
const router = express.Router();

const {
    getWebDevRecords,
    createOrUpdateWebDevRecord
} = require('../controller/webDevController');

const authMiddleware = require('../middlewares/auth.middleware');
const { requireScope } = require('../middlewares/scope.middleware');

router.use(authMiddleware);
router.use(requireScope('web_dev_management'));

router.get('/', getWebDevRecords);
router.post('/', createOrUpdateWebDevRecord);

module.exports = router;
