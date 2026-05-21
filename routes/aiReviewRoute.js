const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const adminMiddleware = require('../middlewares/admin.middleware');
const superAdminMiddleware = require('../middlewares/superAdmin.middleware');
const aiReviewAccessMiddleware = require('../middlewares/aiReviewAccess.middleware');
const reviewDbMiddleware = require('../middlewares/reviewDb.middleware');
const {
    createDataset,
    createLanguage,
    createPromptOptions,
    deleteDataset,
    deleteLanguage,
    deletePromptOption,
    generateReview,
    getAnalyticsGenerations,
    getAnalyticsSummary,
    getDatasets,
    getGeneratorOptions,
    getLanguages,
    getPromptOptions,
    saveFeedback,
    updateAiReviewPermission,
    updateDataset,
    updateLanguage,
    updatePromptOption,
} = require('../controller/aiReviewController');

router.use(authMiddleware);

router.patch('/permissions/:userId', adminMiddleware, updateAiReviewPermission);

router.get('/options', aiReviewAccessMiddleware, reviewDbMiddleware, getGeneratorOptions);
router.post('/generate', aiReviewAccessMiddleware, reviewDbMiddleware, generateReview);
router.patch('/generations/:id/feedback', aiReviewAccessMiddleware, reviewDbMiddleware, saveFeedback);

router.get('/datasets', adminMiddleware, reviewDbMiddleware, getDatasets);
router.post('/datasets', adminMiddleware, reviewDbMiddleware, createDataset);
router.put('/datasets/:id', adminMiddleware, reviewDbMiddleware, updateDataset);
router.delete('/datasets/:id', adminMiddleware, reviewDbMiddleware, deleteDataset);

router.get('/languages', adminMiddleware, reviewDbMiddleware, getLanguages);
router.post('/languages', adminMiddleware, reviewDbMiddleware, createLanguage);
router.put('/languages/:id', adminMiddleware, reviewDbMiddleware, updateLanguage);
router.delete('/languages/:id', adminMiddleware, reviewDbMiddleware, deleteLanguage);

router.get('/prompt-options/:type', adminMiddleware, reviewDbMiddleware, getPromptOptions);
router.post('/prompt-options/:type', adminMiddleware, reviewDbMiddleware, createPromptOptions);
router.put('/prompt-options/:type/:id', adminMiddleware, reviewDbMiddleware, updatePromptOption);
router.delete('/prompt-options/:type/:id', adminMiddleware, reviewDbMiddleware, deletePromptOption);

router.get('/analytics/summary', superAdminMiddleware, reviewDbMiddleware, getAnalyticsSummary);
router.get('/analytics/generations', superAdminMiddleware, reviewDbMiddleware, getAnalyticsGenerations);

module.exports = router;
