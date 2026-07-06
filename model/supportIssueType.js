const mongoose = require('mongoose');
const { supportConnection } = require('../config/supportDb');

const SupportIssueTypeSchema = new mongoose.Schema({
    category_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'SupportCategory',
        required: true,
        index: true,
    },
    title: {
        type: String,
        required: true,
        trim: true,
    },
    priority_default: {
        type: String,
        enum: ['high', 'medium', 'low'],
        default: 'medium',
    },
    is_active: {
        type: Boolean,
        default: true,
        index: true,
    },
    created_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },
    updated_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },
}, { timestamps: true });

SupportIssueTypeSchema.index({ category_id: 1, title: 1 }, { unique: true });

module.exports = supportConnection.model('SupportIssueType', SupportIssueTypeSchema);
