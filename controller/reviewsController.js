
const Review = require('../model/review');
const mongoose = require('mongoose');
// Add Review
const addReview = async (req, res) => {
    try {
        const { business_id, review_count, review_link, review_date } = req.body;

        if (!mongoose.Types.ObjectId.isValid(business_id)) {
            return res.status(400).json({ error: 'Invalid business ID' });
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

        const review = await Review.findOne({ _id: id, user_id: req.user._id });
        if (!review) {
            return res.status(404).json({ error: 'Review not found' });
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

        const deleted = await Review.findOneAndDelete({
            _id: id,
            user_id: req.user._id,
        });

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
            .select('review_count review_link review_date business_id is_paid paid_at paid_review_count updatedAt')
            .populate({
                path: 'business_id',
                select: 'business_name short_code location',
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
            adjustment_extra_paid: 0
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

        const updated = await Review.findOneAndUpdate(
            { _id: id },
            { $set: { is_paid: true, paid_at: new Date(), paid_review_count: review.review_count } },
            { new: true, runValidators: true }
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

// mark as paid to custum date wise review (multiple mark as paid)
const markAsPaidCustomDate = async (req, res) => {
    try {
        const { startDate, endDate } = req.body;
        if (!startDate || !endDate) {
            return res.status(400).json({ error: 'Start date and end date are required' });
        }
        const updated = await Review.updateMany(
            {
                review_date: {
                    $gte: new Date(startDate),
                    $lte: new Date(endDate),
                },
            },
            {
                $set: {
                    is_paid: true,
                    paid_at: new Date()
                }
            }
        );

        // Update paid_review_count for all reviews in this range
        await Review.updateMany(
            {
                review_date: {
                    $gte: new Date(startDate),
                    $lte: new Date(endDate),
                },
                is_paid: true
            },
            [{ $set: { paid_review_count: "$review_count" } }]
        );
        if (!updated) {
            return res.status(404).json({ error: 'Review not found' });
        }
        return res.status(200).json(updated);
    } catch (error) {
        console.error('Mark as Paid Custom Date Error:', error);
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

module.exports = {
    addReview,
    editReview,
    deleteReview,
    getReviewsByUser,
    markAsPaid,
    markAsPaidCustomDate,
    getReviewStats
}