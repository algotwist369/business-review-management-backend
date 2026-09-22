const mongoose = require('mongoose');

const GbpDailyActivitySchema = new mongoose.Schema({
    gbp_update_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'GoogleBusinessProfileUpdates',
        required: true,
        index: true,
    },
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true,
    },
    business_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Business',
        required: true,
        index: true,
    },
    month: {
        type: String,
        required: true,
        index: true,
    },
    activity_date: {
        type: Date,
        required: true,
        index: true,
    },
    changed_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        index: true,
    },
    action: {
        type: String,
        enum: ['created', 'updated', 'deleted', 'legacy_snapshot'],
        required: true,
        index: true,
    },
    changed_fields: [{
        type: String,
        trim: true,
    }],
    previous_data: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
    },
    new_data: {
        type: mongoose.Schema.Types.Mixed,
        default: null,
    },
    changed_fields_count: {
        type: Number,
        default: 0,
    },
    is_legacy: {
        type: Boolean,
        default: false,
        index: true,
    },
    legacy_key: {
        type: String,
        sparse: true,
        unique: true,
    },
}, { timestamps: true });

GbpDailyActivitySchema.index({ activity_date: -1, user_id: 1 });
GbpDailyActivitySchema.index({ activity_date: -1, changed_by: 1 });
GbpDailyActivitySchema.index({ business_id: 1, activity_date: -1 });
GbpDailyActivitySchema.index({ user_id: 1, business_id: 1, month: 1, activity_date: -1 });

module.exports = mongoose.model('GbpDailyActivity', GbpDailyActivitySchema);
