const mongoose = require('mongoose');

const MessageSchema = require('./Message');
const AssetSchema = require('./Asset');

const LeadsManagementSchema = new mongoose.Schema({
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

    double_tick_management: AssetSchema,

    bot_leads_management: AssetSchema,

    spa_advisor_leads: AssetSchema,

    crm_management: AssetSchema,

    spa_advisor_management: AssetSchema,

    message: [MessageSchema],

}, { timestamps: true });

LeadsManagementSchema.index(
    { user_id: 1, business_id: 1 },
    { unique: true }
);

module.exports = mongoose.model('LeadsManagement', LeadsManagementSchema);
