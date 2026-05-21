const mongoose = require('mongoose');
const { reviewConnection } = require('../config/reviewDb');

const reviewLanguageSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 80,
        },
        code: {
            type: String,
            required: true,
            trim: true,
            lowercase: true,
            maxlength: 24,
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

reviewLanguageSchema.index({ code: 1 }, { unique: true });

module.exports = reviewConnection.model('ReviewLanguage', reviewLanguageSchema);
