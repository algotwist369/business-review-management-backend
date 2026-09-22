const mongoose = require('mongoose');

const AssetLinkSchema = new mongoose.Schema({
    title: {
        type: String,
        trim: true,
        default: 'Link',
    },
    url: {
        type: String,
        trim: true,
        required: true,
    },
}, { _id: true });

const AssetSchema = new mongoose.Schema({
    is_created: {
        type: Boolean,
        default: false,
    },
    links: {
        type: [AssetLinkSchema],
        default: [],
    },
    // Legacy fallback. Kept so old records and older clients do not break.
    url: {
        type: String,
        trim: true,
        default: null,
    },
    updated_at: {
        type: Date,
        default: null,
    },
    updated_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },
}, { _id: false });

module.exports = AssetSchema;
