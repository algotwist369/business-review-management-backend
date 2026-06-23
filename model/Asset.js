const mongoose = require('mongoose');

const AssetSchema = new mongoose.Schema({
    is_created: {
        type: Boolean,
        default: false,
    },
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