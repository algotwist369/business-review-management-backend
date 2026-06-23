const express = require('express');
const router = express.Router();

const {
    getLeadsRecords,
    createOrUpdateLeadsRecord
} = require('../controller/leadsController');

const authMiddleware = require('../middlewares/auth.middleware');
const { requireScope } = require('../middlewares/scope.middleware');

router.use(authMiddleware);
router.use(requireScope('leads_management'));

router.get('/', getLeadsRecords);
router.post('/', createOrUpdateLeadsRecord);

module.exports = router;
