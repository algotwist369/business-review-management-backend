const mongoose = require('mongoose');
const { reviewConnection } = require('../config/reviewDb');

const reviewPromptOptionSchema = new mongoose.Schema(
    {
        type: {
            type: String,
            enum: ['service', 'seo_keyword'],
            required: true,
            index: true,
        },
        value: {
            type: String,
            required: true,
            trim: true,
            maxlength: 160,
        },
        is_active: {
            type: Boolean,
            default: true,
            index: true,
        },
        created_by: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
        },
        updated_by: {
            type: mongoose.Schema.Types.ObjectId,
        },
    },
    {
        timestamps: true,
    }
);

reviewPromptOptionSchema.index({ type: 1, value: 1 }, { unique: true });

module.exports = reviewConnection.model('ReviewPromptOption', reviewPromptOptionSchema);
