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
    },
    {
        timestamps: true,
    }
);

// Compound index for fast filtering
reviewSchema.index({ user_id: 1, business_id: 1 });
reviewSchema.index({ is_paid: 1 });

module.exports = mongoose.model('Review', reviewSchema);
