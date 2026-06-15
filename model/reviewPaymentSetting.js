const mongoose = require('mongoose');

const reviewPaymentSettingSchema = new mongoose.Schema(
    {
        key: {
            type: String,
            default: 'global',
            unique: true,
            index: true,
        },
        per_review_price: {
            type: Number,
            default: 0,
            min: 0,
        },
        updated_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

module.exports = mongoose.model('ReviewPaymentSetting', reviewPaymentSettingSchema);
