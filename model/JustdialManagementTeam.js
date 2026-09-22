const mongoose = require('mongoose');

const MessageSchema = require('./Message');
const AssetSchema = require('./Asset');


const JustdialManagementTeamSchema = new mongoose.Schema({
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

    is_live: AssetSchema,

    photo_shoot: AssetSchema,

    video_shoot: AssetSchema,

    is_360_tour: AssetSchema,

    influencer_marketing: AssetSchema,

    message: [MessageSchema],

}, { timestamps: true });

JustdialManagementTeamSchema.index(
    { user_id: 1, business_id: 1 },
    { unique: true }
);

module.exports = mongoose.model('JustdialManagementTeam', JustdialManagementTeamSchema);
