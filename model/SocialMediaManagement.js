const mongoose = require('mongoose');
const MessageSchema = require('./Message');
const SocialProfileSchema = require('./SocialProfile');

const SocialMediaManagementSchema = new mongoose.Schema({
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

    facebook: {
        type: SocialProfileSchema,
        default: () => ({}),
    },

    instagram: {
        type: SocialProfileSchema,
        default: () => ({}),
    },

    twitter: {
        type: SocialProfileSchema,
        default: () => ({}),
    },

    linkedin: {
        type: SocialProfileSchema,
        default: () => ({}),
    },

    pinterest: {
        type: SocialProfileSchema,
        default: () => ({}),
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

    contact_number: {
        is_live: {
            type: Boolean,
            default: false,
        },
        number: {
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
    },

    message: {
        type: [MessageSchema],
        default: [],
    },

    updated_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null,
    },

}, { timestamps: true });

SocialMediaManagementSchema.index(
    {
        user_id: 1,
        business_id: 1,
    },
    {
        unique: true,
    }
);

module.exports = mongoose.model(
    'SocialMediaManagement',
    SocialMediaManagementSchema
);