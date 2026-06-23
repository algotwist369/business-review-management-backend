const mongoose = require('mongoose');

const MessageSchema = require('./Message');
const AssetSchema = require('./Asset');

const GoogleAdsTeamSchema = new mongoose.Schema({
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
    status: {
        type: String,
        enum: ['pending', 'in_progress', 'completed', 'suspended', '404'],
        default: 'pending',
        index: true,
    },

    remarks: {
        type: String,
        trim: true,
        default: null,
    },

    is_gmb_created: AssetSchema,

    is_whatsapp_live: AssetSchema,

    is_number_verified: AssetSchema,

    message: [MessageSchema],

}, { timestamps: true });

GoogleAdsTeamSchema.index(
    { user_id: 1, business_id: 1 },
    { unique: true }
);

module.exports = mongoose.model('GoogleAdsTeam', GoogleAdsTeamSchema);