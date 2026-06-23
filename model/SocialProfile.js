const mongoose = require('mongoose');

const SocialProfileSchema = new mongoose.Schema({
    is_created: {
        type: Boolean,
        default: false,
    },
    is_email_created: {
        type: Boolean,
        default: false,
    },
    url: {
        type: String,
        trim: true,
        default: null,
    },
    username: {
        type: String,
        trim: true,
        default: null,
    },
    password: {
        type: String,
        trim: true,
        default: null,
    },
    phone_number: {
        type: String,
        trim: true,
        default: null,
    },
    email: {
        type: String,
        trim: true,
        default: null,
    },
    fb_campaign: {
        type: Boolean,
        default: false,
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

module.exports = SocialProfileSchema;