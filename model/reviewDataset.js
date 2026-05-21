const mongoose = require('mongoose');
const { reviewConnection } = require('../config/reviewDb');

const reviewDatasetSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: true,
            trim: true,
            maxlength: 120,
        },
        examples: [
            {
                type: String,
                trim: true,
                maxlength: 1500,
            },
        ],
        created_by: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        updated_by: {
            type: mongoose.Schema.Types.ObjectId,
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

reviewDatasetSchema.index({ name: 1, is_active: 1 });

module.exports = reviewConnection.model('ReviewDataset', reviewDatasetSchema);
