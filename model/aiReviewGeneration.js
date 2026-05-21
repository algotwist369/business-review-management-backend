const mongoose = require('mongoose');
const { reviewConnection } = require('../config/reviewDb');

const aiReviewGenerationSchema = new mongoose.Schema(
    {
        user_id: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        user_email: {
            type: String,
            trim: true,
        },
        user_role: {
            type: String,
            enum: ['super_admin', 'admin', 'user'],
            required: true,
        },
        business_id: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            index: true,
        },
        business_name: {
            type: String,
            required: true,
            trim: true,
        },
        services: [
            {
                type: String,
                trim: true,
            },
        ],
        local_seo_keywords: [
            {
                type: String,
                trim: true,
            },
        ],
        tone: {
            type: String,
            trim: true,
        },
        selected_languages: [
            {
                id: String,
                name: String,
                code: String,
            },
        ],
        dataset_reference_used: {
            type: Boolean,
            default: false,
            index: true,
        },
        dataset_id: {
            type: mongoose.Schema.Types.ObjectId,
        },
        dataset_name: {
            type: String,
            trim: true,
        },
        dataset_examples_used: [
            {
                type: String,
                trim: true,
            },
        ],
        prompt_payload: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
        },
        prompt_toon: {
            type: String,
            required: true,
        },
        generated_review: {
            type: String,
            required: true,
            trim: true,
        },
        token_usage: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        feedback_status: {
            type: String,
            enum: ['pending', 'helpful', 'not_helpful'],
            default: 'pending',
            index: true,
        },
        feedback_by: {
            type: mongoose.Schema.Types.ObjectId,
        },
        feedback_at: {
            type: Date,
        },
    },
    {
        timestamps: true,
    }
);

aiReviewGenerationSchema.index({ user_id: 1, createdAt: -1 });
aiReviewGenerationSchema.index({ business_id: 1, createdAt: -1 });

module.exports = reviewConnection.model('AiReviewGeneration', aiReviewGenerationSchema);
