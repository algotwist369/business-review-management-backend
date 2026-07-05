const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
    {
        user_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },

        business_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Business',
            required: true,
            index: true,
        },

        review_date: {
            type: Date,
            default: Date.now,
            index: true,
        },

        review_count: {
            type: Number,
            required: true,
            min: 0,
        },

        review_link: [
            {
                type: String,
                trim: true,
            },
        ],
        is_paid: {
            type: Boolean,
            default: false,
        },
        paid_at: {
            type: Date,
        },
        paid_review_count: {
            type: Number,
            default: 0,
        },
        paid_review_price: {
            type: Number,
            default: 0,
            min: 0,
        },
        paid_amount: {
            type: Number,
            default: 0,
            min: 0,
        },
        // Admin/super admin can verify the review and mark it as verified
        is_verified: {
            type: Boolean,
            default: false,
        },
        verified_at: {
            type: Date,
        },
        verified_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
        },
    },
    {
        timestamps: true,
    }
);

// Compound index for fast filtering
reviewSchema.index({ user_id: 1, business_id: 1 });
reviewSchema.index({ is_paid: 1 });
reviewSchema.index({ is_verified: 1 });
module.exports = mongoose.model('Review', reviewSchema);
