const mongoose = require('mongoose');

const MessageSchema = require('./Message');
const AssetSchema = require('./Asset');

const WebDevTeamSchema = new mongoose.Schema({
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

    is_domain_registered: AssetSchema,
    
    is_website_live: AssetSchema,
    
    is_keywords_site: AssetSchema,
    
    is_main_site: AssetSchema,
    
    is_adsvert_site: AssetSchema,
    
    technology_stack: AssetSchema,

    is_git_hub_repo: AssetSchema,
    
    message: [MessageSchema],

}, { timestamps: true });

WebDevTeamSchema.index(
    { user_id: 1, business_id: 1 },
    { unique: true }
);

module.exports = mongoose.model('WebDevTeam', WebDevTeamSchema);