const express = require('express');
const router = express.Router();

const {
    getJsRecords,
    createOrUpdateJsRecord
} = require('../controller/jsTeamController');

const authMiddleware = require('../middlewares/auth.middleware');
const { requireScope } = require('../middlewares/scope.middleware');

router.use(authMiddleware);
router.use(requireScope('jd_management'));

router.get('/', getJsRecords);
router.post('/', createOrUpdateJsRecord);

module.exports = router;
