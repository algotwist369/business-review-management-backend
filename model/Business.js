const mongoose = require('mongoose');

const businessSchema = new mongoose.Schema(
    {
        business_name: {
            type: String,
            required: true,
            trim: true,
            unique: true,
            index: true,
        },

        location: {
            type: String,
            trim: true,
        },

        short_code: {
            type: String,
            trim: true,
            unique: true,
            index: true,
        },

        business_link: {
            type: String,
            trim: true,
        },

        user_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },

        is_active: {
            type: Boolean,
            default: true,
            index: true,
        },
    },
    {
        timestamps: true,
    }
);

// Compound index (optional but useful for scaling)
businessSchema.index({ business_name: 1, user_id: 1 });

module.exports = mongoose.model('Business', businessSchema);
