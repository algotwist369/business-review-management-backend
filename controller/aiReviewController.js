const mongoose = require('mongoose');
const User = require('../model/user');
const Business = require('../model/Business');
const ReviewDataset = require('../model/reviewDataset');
const ReviewLanguage = require('../model/reviewLanguage');
const ReviewPromptOption = require('../model/reviewPromptOption');
const AiReviewGeneration = require('../model/aiReviewGeneration');
const { generateAiReview } = require('../services/aiReview.service');
const { detectLanguageCode } = require('../services/languageCode.service');

const MAX_DATASET_EXAMPLES = 250;
const OPTION_TYPES = ['service', 'seo_keyword'];

const toCleanArray = (value) => {
    if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean);
    }

    if (typeof value === 'string') {
        return value
            .split(/\r?\n/)
            .map((item) => item.trim())
            .filter(Boolean);
    }

    return [];
};

const canUseBusiness = (user, businessId) =>
    user.role !== 'user' ||
    (user.assigned_businesses || []).some((id) => id.toString() === businessId.toString());

const getTargetUserForGrant = async (actor, userId) => {
    if (!mongoose.Types.ObjectId.isValid(userId)) {
        return { error: 'Invalid user ID', status: 400 };
    }

    const target = await User.findById(userId);
    if (!target || target.is_deleted) {
        return { error: 'User not found', status: 404 };
    }

    if (actor.role === 'super_admin') {
        if (!['admin', 'user'].includes(target.role)) {
            return { error: 'Super Admin can grant AI review access to admins and users only', status: 403 };
        }
        return { target };
    }

    if (actor.role === 'admin') {
        const actorId = actor._id.toString();
        if (target.role !== 'user' || target.managed_by?.toString() !== actorId) {
            return { error: 'Admin can grant AI review access to managed users only', status: 403 };
        }
        return { target };
    }

    return { error: 'Access denied', status: 403 };
};

const updateAiReviewPermission = async (req, res) => {
    try {
        const { enabled } = req.body;
        if (typeof enabled !== 'boolean') {
            return res.status(400).json({ error: 'enabled must be boolean' });
        }

        const result = await getTargetUserForGrant(req.user, req.params.userId);
        if (result.error) {
            return res.status(result.status).json({ error: result.error });
        }

        result.target.ai_review_access = enabled;
        await result.target.save();

        return res.status(200).json({
            message: 'AI review permission updated successfully',
            user: {
                id: result.target._id,
                email: result.target.email,
                role: result.target.role,
                ai_review_access: result.target.ai_review_access,
            },
        });
    } catch (error) {
        console.error('Update AI Review Permission Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const getGeneratorOptions = async (req, res) => {
    try {
        const [datasets, languages, services, seoKeywords] = await Promise.all([
            ReviewDataset.find({ is_active: true })
                .select('_id name createdAt updatedAt')
                .sort({ updatedAt: -1 })
                .lean(),
            ReviewLanguage.find({ is_active: true })
                .select('_id name code')
                .sort({ name: 1 })
                .lean(),
            ReviewPromptOption.find({ type: 'service', is_active: true })
                .select('_id value')
                .sort({ value: 1 })
                .lean(),
            ReviewPromptOption.find({ type: 'seo_keyword', is_active: true })
                .select('_id value')
                .sort({ value: 1 })
                .lean(),
        ]);

        return res.status(200).json({
            datasets,
            languages,
            services,
            seo_keywords: seoKeywords,
        });
    } catch (error) {
        console.error('Get AI Review Options Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const createPromptOptions = async (req, res) => {
    try {
        const { type } = req.params;
        if (!OPTION_TYPES.includes(type)) {
            return res.status(400).json({ error: 'Invalid prompt option type' });
        }

        const values = [...new Set(toCleanArray(req.body.values || req.body.raw_text || req.body.value))]
            .slice(0, 250);
        if (values.length === 0) {
            return res.status(400).json({ error: 'At least one option value is required' });
        }

        const operations = values.map((value) => ({
            updateOne: {
                filter: { type, value },
                update: {
                    $set: {
                        is_active: true,
                        updated_by: req.user._id,
                    },
                    $setOnInsert: {
                        type,
                        value,
                        created_by: req.user._id,
                    },
                },
                upsert: true,
            },
        }));

        await ReviewPromptOption.bulkWrite(operations);
        const options = await ReviewPromptOption.find({ type }).sort({ value: 1 }).lean();

        return res.status(201).json(options);
    } catch (error) {
        console.error('Create Review Prompt Options Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const getPromptOptions = async (req, res) => {
    try {
        const { type } = req.params;
        if (!OPTION_TYPES.includes(type)) {
            return res.status(400).json({ error: 'Invalid prompt option type' });
        }

        const options = await ReviewPromptOption.find({ type })
            .sort({ value: 1 })
            .lean();

        return res.status(200).json(options);
    } catch (error) {
        console.error('Get Review Prompt Options Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const updatePromptOption = async (req, res) => {
    try {
        const { id, type } = req.params;
        if (!OPTION_TYPES.includes(type) || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid prompt option request' });
        }

        const updateData = { updated_by: req.user._id };
        if (typeof req.body.value === 'string' && req.body.value.trim()) {
            updateData.value = req.body.value.trim();
        }
        if (typeof req.body.is_active === 'boolean') {
            updateData.is_active = req.body.is_active;
        }

        const option = await ReviewPromptOption.findOneAndUpdate(
            { _id: id, type },
            { $set: updateData },
            { new: true, runValidators: true }
        ).lean();

        if (!option) {
            return res.status(404).json({ error: 'Prompt option not found' });
        }

        return res.status(200).json(option);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ error: 'Prompt option already exists' });
        }
        console.error('Update Review Prompt Option Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const deletePromptOption = async (req, res) => {
    try {
        const { id, type } = req.params;
        if (!OPTION_TYPES.includes(type) || !mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid prompt option request' });
        }

        const option = await ReviewPromptOption.findOneAndUpdate(
            { _id: id, type },
            { $set: { is_active: false, updated_by: req.user._id } },
            { new: true }
        ).lean();

        if (!option) {
            return res.status(404).json({ error: 'Prompt option not found' });
        }

        return res.status(200).json({ message: 'Prompt option deleted successfully' });
    } catch (error) {
        console.error('Delete Review Prompt Option Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const createDataset = async (req, res) => {
    try {
        const { name } = req.body;
        const examples = toCleanArray(req.body.examples || req.body.raw_text).slice(0, MAX_DATASET_EXAMPLES);

        if (!name?.trim() || examples.length === 0) {
            return res.status(400).json({ error: 'Dataset name and review examples are required' });
        }

        const dataset = await ReviewDataset.create({
            name: name.trim(),
            examples,
            created_by: req.user._id,
            updated_by: req.user._id,
        });

        return res.status(201).json(dataset);
    } catch (error) {
        console.error('Create Review Dataset Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const getDatasets = async (req, res) => {
    try {
        const datasets = await ReviewDataset.find({})
            .sort({ updatedAt: -1 })
            .lean();

        return res.status(200).json(datasets);
    } catch (error) {
        console.error('Get Review Datasets Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const updateDataset = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid dataset ID' });
        }

        const updateData = { updated_by: req.user._id };
        if (typeof req.body.name === 'string' && req.body.name.trim()) {
            updateData.name = req.body.name.trim();
        }
        if (req.body.examples !== undefined || req.body.raw_text !== undefined) {
            const examples = toCleanArray(req.body.examples || req.body.raw_text).slice(0, MAX_DATASET_EXAMPLES);
            if (examples.length === 0) {
                return res.status(400).json({ error: 'Dataset examples cannot be empty' });
            }
            updateData.examples = examples;
        }
        if (typeof req.body.is_active === 'boolean') {
            updateData.is_active = req.body.is_active;
        }

        const dataset = await ReviewDataset.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true, runValidators: true }
        ).lean();

        if (!dataset) {
            return res.status(404).json({ error: 'Dataset not found' });
        }

        return res.status(200).json(dataset);
    } catch (error) {
        console.error('Update Review Dataset Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const deleteDataset = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid dataset ID' });
        }

        const dataset = await ReviewDataset.findByIdAndUpdate(
            id,
            { $set: { is_active: false, updated_by: req.user._id } },
            { new: true }
        ).lean();

        if (!dataset) {
            return res.status(404).json({ error: 'Dataset not found' });
        }

        return res.status(200).json({ message: 'Dataset deleted successfully' });
    } catch (error) {
        console.error('Delete Review Dataset Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const createLanguage = async (req, res) => {
    try {
        const { name, code } = req.body;
        const detectedCode = code?.trim().toLowerCase() || detectLanguageCode(name);
        if (!name?.trim() || !detectedCode) {
            return res.status(400).json({ error: 'Language name and a detectable language code are required' });
        }

        const language = await ReviewLanguage.create({
            name: name.trim(),
            code: detectedCode,
            created_by: req.user._id,
            updated_by: req.user._id,
        });

        return res.status(201).json(language);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ error: 'Language code already exists' });
        }
        console.error('Create Review Language Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const getLanguages = async (req, res) => {
    try {
        const languages = await ReviewLanguage.find({})
            .sort({ name: 1 })
            .lean();

        return res.status(200).json(languages);
    } catch (error) {
        console.error('Get Review Languages Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const updateLanguage = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid language ID' });
        }

        const updateData = { updated_by: req.user._id };
        if (typeof req.body.name === 'string' && req.body.name.trim()) {
            updateData.name = req.body.name.trim();
        }
        if (typeof req.body.code === 'string' && req.body.code.trim()) {
            updateData.code = req.body.code.trim().toLowerCase();
        } else if (typeof req.body.name === 'string' && req.body.name.trim()) {
            const detectedCode = detectLanguageCode(req.body.name);
            if (detectedCode) {
                updateData.code = detectedCode;
            }
        }
        if (typeof req.body.is_active === 'boolean') {
            updateData.is_active = req.body.is_active;
        }

        const language = await ReviewLanguage.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true, runValidators: true }
        ).lean();

        if (!language) {
            return res.status(404).json({ error: 'Language not found' });
        }

        return res.status(200).json(language);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(409).json({ error: 'Language code already exists' });
        }
        console.error('Update Review Language Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const deleteLanguage = async (req, res) => {
    try {
        const { id } = req.params;
        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid language ID' });
        }

        const language = await ReviewLanguage.findByIdAndUpdate(
            id,
            { $set: { is_active: false, updated_by: req.user._id } },
            { new: true }
        ).lean();

        if (!language) {
            return res.status(404).json({ error: 'Language not found' });
        }

        return res.status(200).json({ message: 'Language deleted successfully' });
    } catch (error) {
        console.error('Delete Review Language Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const generateReview = async (req, res) => {
    try {
        const {
            business_id,
            service_ids = [],
            seo_keyword_ids = [],
            services = [],
            local_seo_keywords = [],
            language_ids = [],
            tone,
            use_dataset_reference = false,
            dataset_id,
        } = req.body;

        if (!mongoose.Types.ObjectId.isValid(business_id)) {
            return res.status(400).json({ error: 'Valid business_id is required' });
        }

        const normalizedLanguageIds = [...new Set(toCleanArray(language_ids))];
        if (normalizedLanguageIds.length === 0 || normalizedLanguageIds.some((id) => !mongoose.Types.ObjectId.isValid(id))) {
            return res.status(400).json({ error: 'Select at least one valid language' });
        }

        const business = await Business.findById(business_id)
            .select('_id business_name location is_active')
            .lean();
        if (!business || !business.is_active) {
            return res.status(404).json({ error: 'Active business not found' });
        }
        if (!canUseBusiness(req.user, business._id)) {
            return res.status(403).json({ error: 'You are not assigned to this business' });
        }

        const languages = await ReviewLanguage.find({
            _id: { $in: normalizedLanguageIds },
            is_active: true,
        }).lean();
        if (languages.length !== normalizedLanguageIds.length) {
            return res.status(400).json({ error: 'One or more selected languages are unavailable' });
        }

        const normalizedServiceIds = [...new Set(toCleanArray(service_ids))];
        const normalizedKeywordIds = [...new Set(toCleanArray(seo_keyword_ids))];
        const hasInvalidPromptOptionId = [...normalizedServiceIds, ...normalizedKeywordIds]
            .some((id) => !mongoose.Types.ObjectId.isValid(id));
        if (hasInvalidPromptOptionId) {
            return res.status(400).json({ error: 'One or more selected service or keyword options are invalid' });
        }

        const [selectedServices, selectedKeywords] = await Promise.all([
            normalizedServiceIds.length
                ? ReviewPromptOption.find({
                    _id: { $in: normalizedServiceIds },
                    type: 'service',
                    is_active: true,
                }).lean()
                : [],
            normalizedKeywordIds.length
                ? ReviewPromptOption.find({
                    _id: { $in: normalizedKeywordIds },
                    type: 'seo_keyword',
                    is_active: true,
                }).lean()
                : [],
        ]);

        if (selectedServices.length !== normalizedServiceIds.length || selectedKeywords.length !== normalizedKeywordIds.length) {
            return res.status(400).json({ error: 'One or more selected services or keywords are unavailable' });
        }

        let dataset = null;
        if (use_dataset_reference) {
            if (!mongoose.Types.ObjectId.isValid(dataset_id)) {
                return res.status(400).json({ error: 'Valid dataset_id is required for dataset reference' });
            }
            dataset = await ReviewDataset.findOne({ _id: dataset_id, is_active: true }).lean();
            if (!dataset) {
                return res.status(404).json({ error: 'Dataset not found' });
            }
        }

        const serviceItems = selectedServices.length
            ? selectedServices.map((service) => service.value)
            : toCleanArray(services);
        const keywordItems = selectedKeywords.length
            ? selectedKeywords.map((keyword) => keyword.value)
            : toCleanArray(local_seo_keywords);
        const aiResult = await generateAiReview({
            business,
            services: serviceItems,
            localSeoKeywords: keywordItems,
            languages,
            tone,
            dataset,
        });

        const generation = await AiReviewGeneration.create({
            user_id: req.user._id,
            user_email: req.user.email,
            user_role: req.user.role,
            business_id: business._id,
            business_name: business.business_name,
            services: serviceItems,
            local_seo_keywords: keywordItems,
            tone,
            selected_languages: languages.map((language) => ({
                id: language._id.toString(),
                name: language.name,
                code: language.code,
            })),
            dataset_reference_used: !!dataset,
            dataset_id: dataset?._id,
            dataset_name: dataset?.name,
            dataset_examples_used: aiResult.promptPayload.style_examples,
            prompt_payload: aiResult.promptPayload,
            prompt_toon: aiResult.promptToon,
            generated_review: aiResult.reviewText,
            token_usage: aiResult.tokenUsage,
        });

        return res.status(201).json({
            id: generation._id,
            review: generation.generated_review,
            feedback_status: generation.feedback_status,
            dataset_reference_used: generation.dataset_reference_used,
            selected_languages: generation.selected_languages,
            createdAt: generation.createdAt,
        });
    } catch (error) {
        console.error('Generate AI Review Error:', error);
        return res.status(500).json({ error: error.message || 'Internal Server Error' });
    }
};

const saveFeedback = async (req, res) => {
    try {
        const { id } = req.params;
        const { feedback_status } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid generation ID' });
        }
        if (!['helpful', 'not_helpful'].includes(feedback_status)) {
            return res.status(400).json({ error: 'feedback_status must be helpful or not_helpful' });
        }

        const filter = { _id: id };
        if (req.user.role === 'user') {
            filter.user_id = req.user._id;
        }

        const generation = await AiReviewGeneration.findOneAndUpdate(
            filter,
            {
                $set: {
                    feedback_status,
                    feedback_by: req.user._id,
                    feedback_at: new Date(),
                },
            },
            { new: true }
        ).lean();

        if (!generation) {
            return res.status(404).json({ error: 'Generated review not found' });
        }

        return res.status(200).json({
            id: generation._id,
            feedback_status: generation.feedback_status,
            feedback_at: generation.feedback_at,
        });
    } catch (error) {
        console.error('Save AI Review Feedback Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const getAnalyticsSummary = async (req, res) => {
    try {
        const [users, datasets, languages, services, seoKeywords, totals] = await Promise.all([
            AiReviewGeneration.aggregate([
                {
                    $group: {
                        _id: '$user_id',
                        user_email: { $last: '$user_email' },
                        user_role: { $last: '$user_role' },
                        generated_reviews: { $sum: 1 },
                        helpful: { $sum: { $cond: [{ $eq: ['$feedback_status', 'helpful'] }, 1, 0] } },
                        not_helpful: { $sum: { $cond: [{ $eq: ['$feedback_status', 'not_helpful'] }, 1, 0] } },
                        last_generated_at: { $max: '$createdAt' },
                    },
                },
                { $sort: { generated_reviews: -1, last_generated_at: -1 } },
            ]),
            ReviewDataset.find({}).select('_id name is_active updatedAt').sort({ updatedAt: -1 }).lean(),
            ReviewLanguage.find({}).select('_id name code is_active').sort({ name: 1 }).lean(),
            ReviewPromptOption.find({ type: 'service' }).select('_id value is_active').sort({ value: 1 }).lean(),
            ReviewPromptOption.find({ type: 'seo_keyword' }).select('_id value is_active').sort({ value: 1 }).lean(),
            AiReviewGeneration.aggregate([
                {
                    $group: {
                        _id: null,
                        generated_reviews: { $sum: 1 },
                        dataset_referenced_reviews: {
                            $sum: { $cond: [{ $eq: ['$dataset_reference_used', true] }, 1, 0] },
                        },
                        pending_feedback: {
                            $sum: { $cond: [{ $eq: ['$feedback_status', 'pending'] }, 1, 0] },
                        },
                    },
                },
            ]),
        ]);

        return res.status(200).json({
            totals: totals[0] || {
                generated_reviews: 0,
                dataset_referenced_reviews: 0,
                pending_feedback: 0,
            },
            users,
            datasets,
            languages,
            services,
            seo_keywords: seoKeywords,
        });
    } catch (error) {
        console.error('Get AI Review Analytics Summary Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const getAnalyticsGenerations = async (req, res) => {
    try {
        const page = Math.max(Number(req.query.page || 1), 1);
        const limit = Math.min(Math.max(Number(req.query.limit || 20), 1), 100);
        const skip = (page - 1) * limit;

        const [data, total] = await Promise.all([
            AiReviewGeneration.find({})
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
                .lean(),
            AiReviewGeneration.countDocuments({}),
        ]);

        return res.status(200).json({ total, page, limit, data });
    } catch (error) {
        console.error('Get AI Review Analytics Generations Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

module.exports = {
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
};
