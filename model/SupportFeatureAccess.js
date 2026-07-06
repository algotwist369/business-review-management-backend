const mongoose = require('mongoose');

const SupportFeatureAccessSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true,
        index: true,
    },
    allowed_scopes: {
        type: [String],
        default: [],
        index: true,
    },
    can_raise: {
        type: Boolean,
        default: true,
    },
    can_manage: {
        type: Boolean,
        default: false,
    },
    granted_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },
}, { timestamps: true });

SupportFeatureAccessSchema.index({ can_manage: 1, allowed_scopes: 1 });

module.exports = mongoose.model('SupportFeatureAccess', SupportFeatureAccessSchema);
