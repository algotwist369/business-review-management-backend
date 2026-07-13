
const Review = require('../model/review');
const mongoose = require('mongoose');
const Business = require('../model/Business');
const ReviewPaymentSetting = require('../model/reviewPaymentSetting');

const isAssignedBusiness = (user, businessId) =>
    (user.assigned_businesses || []).some((id) => id.toString() === businessId.toString());

const canManageReview = async (user, review) => {
    if (!review) return false;
    if (review.user_id.toString() === user._id.toString()) return true;
    if (user.role === 'super_admin') return true;

    if (user.role === 'admin') {
        const reviewOwner = await mongoose.model('User').findOne({
            _id: review.user_id,
            managed_by: user._id,
            is_deleted: false,
        }).select('_id').lean();

        return !!reviewOwner;
    }

    return false;
};

const buildDateRangePaymentQuery = async (user, startDate, endDate, userId) => {
    // Set start date to 00:00:00 and end date to 23:59:59.999
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    const query = {
        review_date: {
            $gte: start,
            $lte: end,
        },
    };

    if (userId) {
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            const error = new Error('Invalid user ID');
            error.statusCode = 400;
            throw error;
        }

        if (user.role === 'admin') {
            const managedUser = await mongoose.model('User').findOne({
                _id: userId,
                managed_by: user._id,
                is_deleted: false,
            }).select('_id').lean();

            if (!managedUser && user._id.toString() !== userId.toString()) {
                const error = new Error('Access denied');
                error.statusCode = 403;
                throw error;
            }
        }

        query.user_id = new mongoose.Types.ObjectId(userId);
        return query;
    }

    if (user.role === 'admin') {
        const managedUsers = await mongoose.model('User')
            .find({ managed_by: user._id, is_deleted: false })
            .select('_id')
            .lean();

        query.user_id = {
            $in: [
                user._id,
                ...managedUsers.map((managedUser) => managedUser._id),
            ],
        };
    }

    return query;
};

const parsePerReviewPrice = (value) => {
    const price = Number(value);
    return Number.isFinite(price) && price > 0 ? price : null;
};

const getReviewPaymentSetting = async () => {
    const setting = await ReviewPaymentSetting.findOne({ key: 'global' }).lean();
    return setting || { key: 'global', per_review_price: 0 };
};

const resolvePerReviewPrice = async (value) => {
    const requestedPrice = parsePerReviewPrice(value);
    if (requestedPrice) return requestedPrice;

    const setting = await getReviewPaymentSetting();
    return parsePerReviewPrice(setting.per_review_price);
};

const getPaymentSetting = async (req, res) => {
    try {
        const setting = await getReviewPaymentSetting();
        return res.status(200).json(setting);
    } catch (error) {
        console.error('Get Payment Setting Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

const updatePaymentSetting = async (req, res) => {
    try {
        const perReviewPrice = parsePerReviewPrice(req.body?.perReviewPrice);
        if (!perReviewPrice) {
            return res.status(400).json({ error: 'Valid per review price is required' });
        }

        const setting = await ReviewPaymentSetting.findOneAndUpdate(
            { key: 'global' },
            {
                $set: {
                    per_review_price: perReviewPrice,
                    updated_by: req.user._id,
                }
            },
            { upsert: true, returnDocument: "after", runValidators: true }
        ).lean();

        return res.status(200).json(setting);
    } catch (error) {
        console.error('Update Payment Setting Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};
// Add Review
const addReview = async (req, res) => {
    try {
        const { business_id, review_count, review_link, review_date } = req.body;

        if (!mongoose.Types.ObjectId.isValid(business_id)) {
            return res.status(400).json({ error: 'Invalid business ID' });
        }

        const business = await Business.findById(business_id).select('_id').lean();
        if (!business) {
            return res.status(404).json({ error: 'Business not found' });
        }

        // Check if user is assigned to this business
        if (req.user.role === 'user') {
            if (!isAssignedBusiness(req.user, business_id)) {
                return res.status(403).json({ error: 'You are not assigned to this business' });
            }
        }

        if (review_count < 0) {
            return res.status(400).json({ error: 'Review count must be positive' });
        }

        const review = await Review.create({
            user_id: req.user._id,
            business_id,
            review_date,
            review_count,
            review_link,
        });

        const { handleWorkspaceCompletion } = require('../services/notificationService');
        handleWorkspaceCompletion(req.user._id, business_id);

        return res.status(201).json(review);

    } catch (error) {
        console.error('Add Review Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// edit review count
const editReview = async (req, res) => {
    try {
        const { id } = req.params;
        const { review_count, review_link, review_date } = req.body;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        const review = await Review.findById(id);
        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }

        const hasAccess = await canManageReview(req.user, review);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const updateData = {
            review_count,
            review_link,
            review_date,
            is_verified: false,
            verified_at: null,
            verified_by: null,
        };

        // If it's a legacy paid review (is_paid: true but paid_review_count: 0),
        // we lock the current (old) count as the paid count so that this new edit shows an adjustment.
        if (review.is_paid && !review.paid_review_count) {
            updateData.paid_review_count = review.review_count;
        }

        const updated = await Review.findByIdAndUpdate(
            id,
            { $set: updateData },
            { returnDocument: "after", runValidators: true }
        ).lean();

        if (!updated) {
            return res.status(404).json({ error: 'Review not found' });
        }

        const { handleWorkspaceCompletion } = require('../services/notificationService');
        handleWorkspaceCompletion(updated.user_id, updated.business_id);

        return res.status(200).json(updated);

    } catch (error) {
        console.error('Edit Review Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// delete review count
const deleteReview = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        const review = await Review.findById(id);
        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }

        const hasAccess = await canManageReview(req.user, review);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const deleted = await Review.findByIdAndDelete(id);

        if (!deleted) {
            return res.status(404).json({ error: 'Review not found' });
        }

        return res.status(200).json({ message: 'Review deleted successfully' });

    } catch (error) {
        console.error('Delete Review Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// =========== Admin routes ==========

// Get all reviews by user id
const getReviewsByUser = async (req, res) => {
    try {
        // Admin check
        const { userId } = req.params;
        const { page = 1, limit = 20, filterType, startDate: start, endDate: end, search, location, paymentStatus, verificationStatus } = req.query;

        console.log('getReviewsByUser params:', { userId, search, location, paymentStatus, verificationStatus, filterType });

        // Allow access if admin, super_admin OR if viewing own reviews
        if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'super_admin' && req.user.id.toString() !== userId)) {
            return res.status(403).json({ error: 'Access denied: Admin only or own reviews only' });
        }

        if (!mongoose.Types.ObjectId.isValid(userId)) {
            return res.status(400).json({ error: 'Invalid user ID' });
        }

        const skip = (Number(page) - 1) * Number(limit);

        let dateMatch = {};
        const now = new Date();

        if (filterType === 'weekly') {
            const lastWeek = new Date();
            lastWeek.setDate(now.getDate() - 7);
            const startOfLastWeek = new Date(lastWeek.setHours(0, 0, 0, 0));
            const endOfNow = new Date(now.setHours(23, 59, 59, 999));
            dateMatch = { review_date: { $gte: startOfLastWeek, $lte: endOfNow } };
        } else if (filterType === 'monthly') {
            const lastMonth = new Date();
            lastMonth.setMonth(now.getMonth() - 1);
            const startOfLastMonth = new Date(lastMonth.setHours(0, 0, 0, 0));
            const endOfNow = new Date(now.setHours(23, 59, 59, 999));
            dateMatch = { review_date: { $gte: startOfLastMonth, $lte: endOfNow } };
        } else if (filterType === 'custom' && start && end) {
            const startDate = new Date(start);
            startDate.setHours(0, 0, 0, 0);
            const endDate = new Date(end);
            endDate.setHours(23, 59, 59, 999);
            dateMatch = {
                review_date: {
                    $gte: startDate,
                    $lte: endDate
                }
            };
        }

        // Build pipeline stage for business search and location filter
        let businessMatchStage = {};
        if (search) {
            businessMatchStage['business.business_name'] = { $regex: search, $options: 'i' };
        }
        if (location) {
            businessMatchStage['business.location'] = { $regex: location, $options: 'i' };
        }
        console.log('🔍 businessMatchStage:', businessMatchStage);

        // Payment and verification filters
        let paymentMatchStage = {};
        if (paymentStatus === 'paid') {
            paymentMatchStage['is_paid'] = true;
        } else if (paymentStatus === 'unpaid') {
            paymentMatchStage['is_paid'] = false;
        }

        let verificationMatchStage = {};
        if (verificationStatus === 'verified') {
            verificationMatchStage['is_verified'] = true;
        } else if (verificationStatus === 'unverified') {
            verificationMatchStage['is_verified'] = { $ne: true };
        }
        console.log('review filter stages:', { paymentMatchStage, verificationMatchStage });
        // Aggregation pipeline: first filter reviews, then lookup business, then apply business filters, then get totals and paginate
        const basePipeline = [
            { $match: { user_id: new mongoose.Types.ObjectId(userId), ...dateMatch, ...paymentMatchStage, ...verificationMatchStage } },
            {
                $lookup: {
                    from: 'businesses',
                    localField: 'business_id',
                    foreignField: '_id',
                    as: 'business'
                }
            },
            { $unwind: '$business' },
            { $match: businessMatchStage },
            {
                $lookup: {
                    from: 'users',
                    localField: 'verified_by',
                    foreignField: '_id',
                    as: 'verified_by'
                }
            },
            {
                $unwind: {
                    path: '$verified_by',
                    preserveNullAndEmptyArrays: true
                }
            }
        ];

        // Debug: let's see what the first few steps return
        const debugPipeline1 = [
            { $match: { user_id: new mongoose.Types.ObjectId(userId), ...dateMatch, ...paymentMatchStage, ...verificationMatchStage } },
            {
                $lookup: {
                    from: 'businesses',
                    localField: 'business_id',
                    foreignField: '_id',
                    as: 'business'
                }
            },
        ];
        const debugData1 = await Review.aggregate(debugPipeline1);
        console.log('🔍 Debug1 after $lookup (before $unwind and $match):', debugData1.slice(0, 3));
        console.log('🔍 Debug1 data length:', debugData1.length);

        const debugPipeline2 = [
            ...debugPipeline1,
            { $unwind: '$business' },
            { $match: businessMatchStage },
        ];
        const debugData2 = await Review.aggregate(debugPipeline2);
        console.log('🔍 Debug2 after $unwind and $match:', debugData2.slice(0, 3));
        console.log('🔍 Debug2 data length:', debugData2.length);

        // Pipeline for totals
        const totalsPipeline = [
            ...basePipeline,
            {
                $group: {
                    _id: null,
                    total_reviews: { $sum: '$review_count' },
                    total_paid_reviews: {
                        $sum: { $cond: [{ $eq: ['$is_paid', true] }, '$review_count', 0] }
                    },
                    total_paid_reviews_locked: {
                        $sum: {
                            $cond: [
                                { $eq: ['$is_paid', true] },
                                { $cond: [{ $gt: ['$paid_review_count', 0] }, '$paid_review_count', '$review_count'] },
                                0
                            ]
                        }
                    },
                    total_pending_reviews: {
                        $sum: {
                            $add: [
                                { $cond: [{ $eq: ['$is_paid', false] }, '$review_count', 0] },
                                {
                                    $cond: [
                                        {
                                            $and: [
                                                { $eq: ['$is_paid', true] },
                                                { $gt: ['$paid_review_count', 0] },
                                                { $gt: ['$review_count', '$paid_review_count'] }
                                            ]
                                        },
                                        { $subtract: ['$review_count', '$paid_review_count'] },
                                        0
                                    ]
                                }
                            ]
                        }
                    },
                    total_entries: { $sum: 1 },
                    total_paid_entries: {
                        $sum: { $cond: [{ $eq: ['$is_paid', true] }, 1, 0] }
                    },
                    adjustment_unpaid: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ['$is_paid', true] },
                                        { $gt: ['$paid_review_count', 0] },
                                        { $gt: ['$review_count', '$paid_review_count'] }
                                    ]
                                },
                                { $subtract: ['$review_count', '$paid_review_count'] },
                                0
                            ]
                        }
                    },
                    adjustment_extra_paid: {
                        $sum: {
                            $cond: [
                                {
                                    $and: [
                                        { $eq: ['$is_paid', true] },
                                        { $gt: ['$paid_review_count', 0] },
                                        { $lt: ['$review_count', '$paid_review_count'] }
                                    ]
                                },
                                { $subtract: ['$paid_review_count', '$review_count'] },
                                0
                            ]
                        }
                    },
                    total_paid_amount: {
                        $sum: { $cond: [{ $eq: ['$is_paid', true] }, '$paid_amount', 0] }
                    }
                }
            }
        ];

        // Pipeline for paginated reviews
        const reviewsPipeline = [
            ...basePipeline,
            { $sort: { review_date: -1 } },
            { $skip: skip },
            { $limit: Number(limit) },
            {
                $project: {
                    review_count: 1,
                    review_link: 1,
                    review_date: 1,
                    business_id: {
                        _id: '$business._id',
                        business_name: '$business.business_name',
                        short_code: '$business.short_code',
                        location: '$business.location',
                        business_link: '$business.business_link'
                    },
                    is_paid: 1,
                    paid_at: 1,
                    paid_review_count: 1,
                    paid_review_price: 1,
                    paid_amount: 1,
                    is_verified: 1,
                    verified_at: 1,
                    verified_by: { $cond: ['$verified_by', { username: '$verified_by.username', email: '$verified_by.email', role: '$verified_by.role' }, null] },
                    updatedAt: 1
                }
            }
        ];

        // Execute both pipelines in parallel
        const [totals, reviews] = await Promise.all([
            Review.aggregate(totalsPipeline),
            Review.aggregate(reviewsPipeline)
        ]);

        console.log('🔍 totals pipeline result:', totals);
        console.log('🔍 reviews pipeline result length:', reviews.length);
        console.log('🔍 reviews pipeline first 2:', reviews.slice(0, 2));

        const userStats = totals[0] || {
            total_reviews: 0,
            total_paid_reviews: 0,
            total_paid_reviews_locked: 0,
            total_pending_reviews: 0,
            total_entries: 0,
            total_paid_entries: 0,
            adjustment_unpaid: 0,
            adjustment_extra_paid: 0,
            total_paid_amount: 0
        };

        const responseData = {
            total_review_count: userStats.total_reviews,
            total_paid_review_count: userStats.total_paid_reviews,
            total_pending_review_count: userStats.total_pending_reviews,
            total_paid_review_count_locked: userStats.total_paid_reviews_locked,
            total_business: userStats.total_entries,
            total_paid_business: userStats.total_paid_entries,
            adjustment_unpaid: userStats.adjustment_unpaid,
            adjustment_extra_paid: userStats.adjustment_extra_paid,
            total_paid_amount: userStats.total_paid_amount,
            page: Number(page),
            limit: Number(limit),
            data: reviews,
        };

        console.log('🔍 final response data:', responseData);

        return res.status(200).json(responseData);

    } catch (error) {
        console.error('Get Reviews Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// mark as paid
const markAsPaid = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        const review = await Review.findById(id);
        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }

        const hasAccess = await canManageReview(req.user, review);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied' });
        }

        if (!review.is_verified) {
            return res.status(400).json({ error: 'Review must be verified before marking as paid' });
        }

        const perReviewPrice = await resolvePerReviewPrice(review.is_paid ? review.paid_review_price : req.body?.perReviewPrice);
        if (!perReviewPrice) {
            return res.status(400).json({ error: 'Please set per review price first' });
        }

        const updated = await Review.findOneAndUpdate(
            { _id: id },
            {
                $set: {
                    is_paid: true,
                    paid_at: new Date(),
                    paid_review_count: review.review_count,
                    paid_review_price: perReviewPrice,
                    paid_amount: review.review_count * perReviewPrice,
                }
            },
            { returnDocument: 'after', runValidators: true }
        ).lean();

        if (!updated) {
            return res.status(404).json({ error: 'Review not found' });
        }

        return res.status(200).json(updated);

    } catch (error) {
        console.error('Mark as Paid Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// mark as unpaid
const markAsUnpaid = async (req, res) => {
    try {
        const { id } = req.params;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        const review = await Review.findById(id);
        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }

        const hasAccess = await canManageReview(req.user, review);
        if (!hasAccess) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const updated = await Review.findOneAndUpdate(
            { _id: id },
            { $set: { is_paid: false, paid_at: null, paid_review_count: 0, paid_review_price: 0, paid_amount: 0 } },
            { returnDocument: 'after', runValidators: true }
        ).lean();

        if (!updated) {
            return res.status(404).json({ error: 'Review not found' });
        }

        return res.status(200).json(updated);

    } catch (error) {
        console.error('Mark as Unpaid Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// mark as paid to custum date wise review (multiple mark as paid)
const markAsPaidCustomDate = async (req, res) => {
    try {
        const { startDate, endDate, userId } = req.body;
        const perReviewPrice = await resolvePerReviewPrice(req.body?.perReviewPrice);
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'Start date and end date are required' });
        }
        if (!perReviewPrice) {
            return res.status(400).json({ error: 'Please set per review price first' });
        }
        const query = await buildDateRangePaymentQuery(req.user, startDate, endDate, userId);

        const reviews = await Review.find(query).select('_id review_count is_verified').lean();

        if (!reviews.length) {
            return res.status(404).json({ error: 'Review not found' });
        }

        const unverifiedCount = reviews.filter(review => !review.is_verified).length;
        if (unverifiedCount > 0) {
            return res.status(400).json({ error: `${unverifiedCount} review entries must be verified before marking this range as paid` });
        }

        const paidAt = new Date();
        const paidReviewCount = reviews.reduce((sum, review) => sum + (Number(review.review_count) || 0), 0);
        const totalAmount = paidReviewCount * perReviewPrice;
        const updated = await Review.bulkWrite(
            reviews.map((review) => ({
                updateOne: {
                    filter: { _id: review._id },
                    update: {
                        $set: {
                            is_paid: true,
                            paid_at: paidAt,
                            paid_review_count: review.review_count,
                            paid_review_price: perReviewPrice,
                            paid_amount: review.review_count * perReviewPrice,
                        },
                    },
                },
            }))
        );

        return res.status(200).json({
            matchedCount: updated.matchedCount,
            modifiedCount: updated.modifiedCount,
            paidReviewCount,
            perReviewPrice,
            totalAmount,
        });
    } catch (error) {
        console.error('Mark as Paid Custom Date Error:', error);
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

// mark as unpaid to custom date wise review (multiple mark as unpaid)
const markAsUnpaidCustomDate = async (req, res) => {
    try {
        const { startDate, endDate, userId } = req.body;
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'Start date and end date are required' });
        }
        const query = await buildDateRangePaymentQuery(req.user, startDate, endDate, userId);

        const updated = await Review.updateMany(
            query,
            {
                $set: {
                    is_paid: false,
                    paid_at: null,
                    paid_review_count: 0,
                    paid_review_price: 0,
                    paid_amount: 0
                }
            }
        );

        if (!updated) {
            return res.status(404).json({ error: 'Review not found' });
        }
        return res.status(200).json(updated);
    } catch (error) {
        console.error('Mark as Unpaid Custom Date Error:', error);
        if (error.statusCode) {
            return res.status(error.statusCode).json({ error: error.message });
        }
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}

// stats -> total reviews by user, total reviews for a business, average reviews per business, etc.
const getReviewStats = async (req, res) => {
    try {
        if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Admin only' });
        }

        const stats = await Review.aggregate([
            {
                $group: {
                    _id: '$business_id',
                    totalReviews: { $sum: '$review_count' },
                    averageReviews: { $avg: '$review_count' },
                },
            },
            {
                $lookup: {
                    from: 'businesses',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'business',
                },
            },
            { $unwind: '$business' },
            {
                $project: {
                    business_name: '$business.business_name',
                    totalReviews: 1,
                    averageReviews: 1,
                },
            },
        ]);

        const totalSystemReviews = await Review.aggregate([
            {
                $group: {
                    _id: null,
                    total: { $sum: '$review_count' },
                },
            },
        ]);

        return res.status(200).json({
            businessStats: stats,
            totalSystemReviews: totalSystemReviews[0]?.total || 0,
        });

    } catch (error) {
        console.error('Stats Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Get reviews for a specific business with pagination and access control
const getReviewsForBusiness = async (req, res) => {
    try {
        const { businessId } = req.params;
        const { page = 1, limit = 20 } = req.query;
        const pageNumber = Number(page);
        const limitNumber = Number(limit);

        if (!mongoose.Types.ObjectId.isValid(businessId)) {
            return res.status(400).json({ error: 'Invalid business ID' });
        }

        if (!Number.isFinite(pageNumber) || pageNumber < 1 || !Number.isFinite(limitNumber) || limitNumber < 1) {
            return res.status(400).json({ error: 'Invalid pagination parameters' });
        }

        if (
            req.user.role === 'user' &&
            !isAssignedBusiness(req.user, businessId)
        ) {
            return res.status(403).json({ error: 'You are not assigned to this business' });
        }

        const skip = (pageNumber - 1) * limitNumber;
        const query = { business_id: businessId };

        const [reviews, total, totalReviewAggregate] = await Promise.all([
            Review.find(query)
                .populate('business_id', 'business_name short_code location business_link')
                .populate('user_id', 'email username')
                .populate('verified_by', 'username email role')
                .sort({ review_date: -1 })
                .skip(skip)
                .limit(limitNumber)
                .lean(),
            Review.countDocuments(query),
            Review.aggregate([
                { $match: { business_id: new mongoose.Types.ObjectId(businessId) } },
                { $group: { _id: null, count: { $sum: '$review_count' } } },
            ]),
        ]);

        return res.status(200).json({
            total,
            page: pageNumber,
            limit: limitNumber,
            total_review_count: totalReviewAggregate[0]?.count || 0,
            data: reviews,
        });
    } catch (error) {
        console.error('Get Reviews For Business Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
};

// Admin and Super Admin can verify or unverify a review.
const verifyReview = async (req, res) => {
    try {
        const { id } = req.params;
        const requestedVerified = req.body?.is_verified;
        const shouldVerify = requestedVerified === undefined ? true : requestedVerified === true;

        if (!mongoose.Types.ObjectId.isValid(id)) {
            return res.status(400).json({ error: 'Invalid review ID' });
        }

        if (req.user.role !== 'admin' && req.user.role !== 'super_admin') {
            return res.status(403).json({ error: 'Access denied: Admin only' });
        }

        const review = await Review.findById(id).select('user_id is_paid is_verified').lean();
        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
        }

        if (req.user.role === 'admin') {
            const isOwnReview = review.user_id.toString() === req.user._id.toString();
            const managedUser = isOwnReview ? true : await mongoose.model('User').findOne({
                _id: review.user_id,
                managed_by: req.user._id,
                is_deleted: false,
            }).select('_id').lean();

            if (!managedUser) {
                return res.status(403).json({ error: 'Access denied: You can only verify reviews of users you manage only' });
            }
        }

        if (!shouldVerify && review.is_paid) {
            return res.status(400).json({ error: 'Paid review entries cannot be unverified. Mark it unpaid first.' });
        }

        const update = shouldVerify
            ? {
                $set: {
                    is_verified: true,
                    verified_at: new Date(),
                    verified_by: req.user._id,
                }
            }
            : {
                $set: {
                    is_verified: false,
                    verified_at: null,
                    verified_by: null,
                }
            };

        const updated = await Review.findOneAndUpdate(
            { _id: id },
            update,
            { returnDocument: 'after', runValidators: true }
        )
            .populate('verified_by', 'username email role')
            .lean();

        if (!updated) {
            return res.status(404).json({ error: 'Review not found' });
        }

        return res.status(200).json({
            message: shouldVerify ? 'Review verified successfully' : 'Review unverified successfully',
            review: updated
        });
    } catch (error) {
        console.error('Verify Review Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
module.exports = {
    addReview,
    editReview,
    deleteReview,
    getReviewsByUser,
    getPaymentSetting,
    updatePaymentSetting,
    markAsPaid,
    markAsPaidCustomDate,
    markAsUnpaid,
    markAsUnpaidCustomDate,
    getReviewStats,
    getReviewsForBusiness,
    verifyReview,
}
