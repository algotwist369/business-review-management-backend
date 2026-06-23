const mongoose = require('mongoose');
const messageSchema = require('./Message');
const AssetsSchema = require('./Asset');

const GoogleBusinessProfileUpdatesSchema = new mongoose.Schema({
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

    // Example: 2026-06
    month: {
        type: String,
        required: true,
        index: true,
    },

    // Product Updates Count
    product_count: {
        type: Number,
        default: 0,
        min: 0,
    },

    // Service Updates Count
    service_count: {
        type: Number,
        default: 0,
        min: 0,
    },

    // Media / Image Upload Count
    media_count: {
        type: Number,
        default: 0,
        min: 0,
    },

    // Post Schedule Range
    post_start_date: {
        type: Date,
        index: true,
    },

    post_end_date: {
        type: Date,
        index: true,
    },

    // Total Scheduled Posts
    scheduled_posts_count: {
        type: Number,
        default: 0,
        min: 0,
    },

    update_link: {
        type: String,
        trim: true,
    },

    status: {
        type: String,
        enum: [
            'pending',
            'in_progress',
            'completed',
            'suspended',
            '404'
        ],
        default: 'pending',
        index: true,
    },

    remarks: {
        type: String,
        trim: true,
    },

    is_number_live: AssetsSchema,

    is_whatsapp_live: AssetsSchema,

    is_website_live: AssetsSchema,

    is_email_live: AssetsSchema,

    message: [messageSchema],

    updated_by: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
    },

}, { timestamps: true });


// One record per User per Business per Month
GoogleBusinessProfileUpdatesSchema.index(
    {
        user_id: 1,
        business_id: 1,
        month: 1,
    },
    {
        unique: true,
    }
);

const GoogleBusinessProfileUpdates = mongoose.model(
    'GoogleBusinessProfileUpdates',
    GoogleBusinessProfileUpdatesSchema
);

// Drop old unique index if it exists, to allow multiple users on the same business
GoogleBusinessProfileUpdates.collection.dropIndex('business_id_1_month_1').catch(err => {
    // Ignore if index doesn't exist
});

module.exports = GoogleBusinessProfileUpdates;