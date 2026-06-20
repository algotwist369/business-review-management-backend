
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
    const query = {
        review_date: {
            $gte: new Date(startDate),
            $lte: new Date(endDate),
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
            { upsert: true, new: true, runValidators: true }
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

        const updateData = { review_count, review_link, review_date };

        // If it's a legacy paid review (is_paid: true but paid_review_count: 0),
        // we lock the current (old) count as the paid count so that this new edit shows an adjustment.
        if (review.is_paid && !review.paid_review_count) {
            updateData.paid_review_count = review.review_count;
        }

        const updated = await Review.findByIdAndUpdate(
            id,
            { $set: updateData },
            { new: true, runValidators: true }
        ).lean();

        if (!updated) {
            return res.status(404).json({ error: 'Review not found' });
        }

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

// ===========Admin routes==========

// Get all reviews by user id
const getReviewsByUser = async (req, res) => {
    try {
        // Admin check
        const { userId } = req.params;
        const { page = 1, limit = 20, filterType, startDate: start, endDate: end } = req.query;

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
            dateMatch = { review_date: { $gte: lastWeek, $lte: now } };
        } else if (filterType === 'monthly') {
            const lastMonth = new Date();
            lastMonth.setMonth(now.getMonth() - 1);
            dateMatch = { review_date: { $gte: lastMonth, $lte: now } };
        } else if (filterType === 'custom' && start && end) {
            dateMatch = {
                review_date: {
                    $gte: new Date(start),
                    $lte: new Date(end)
                }
            };
        }

        const query = { user_id: userId, ...dateMatch };

        // Fetch paginated reviews
        const reviews = await Review.find(query)
            .select('review_count review_link review_date business_id is_paid paid_at paid_review_count paid_review_price paid_amount updatedAt')
            .populate({
                path: 'business_id',
                select: 'business_name short_code location business_link',
            })
            .sort({ review_date: -1 })
            .skip(skip)
            .limit(Number(limit))
            .lean();

        // Use aggregation to get accurate totals across all pages for this user
        const totals = await Review.aggregate([
            { $match: { user_id: new mongoose.Types.ObjectId(userId), ...dateMatch } },
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
                                        { $gt: ['$paid_review_count', 0] }, // Only if locked count exists
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
                                        { $gt: ['$paid_review_count', 0] }, // Only if locked count exists
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
        ]);

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

        return res.status(200).json({
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
        });

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

        const reviews = await Review.find(query).select('_id review_count').lean();

        if (!reviews.length) {
            return res.status(404).json({ error: 'Review not found' });
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
}
