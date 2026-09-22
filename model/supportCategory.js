const mongoose = require('mongoose');
const { supportConnection } = require('../config/supportDb');

const SupportCategorySchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true,
    },
    scope_key: {
        type: String,
        required: true,
        trim: true,
        index: true,
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

SupportCategorySchema.index({ scope_key: 1, name: 1 }, { unique: true });

module.exports = supportConnection.model('SupportCategory', SupportCategorySchema);
