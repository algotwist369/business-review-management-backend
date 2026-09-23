const mongoose = require('mongoose');

const businessSchema = new mongoose.Schema(
    {
        business_name: {
            type: String,
            required: true,
            trim: true,
            index: true,
        },

        location: {
            type: String,
            trim: true,
        },

        short_code: {
            type: String,
            trim: true,
            unique: true,
        },

        business_link: {
            type: String,
            trim: true,
        },

        user_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true,
        },

        is_active: {
            type: Boolean,
            default: true,
            index: true,
        },

        // Show as NEW for first 7 days
        is_new: {
            type: Boolean,
            default: true,
            index: true,
        },

        
        // if admin edit business details, then this will be true, otherwise false and add a remark so that user can see the remark and edit the business details again with notification
        is_edited:{
            type: Boolean,
            default: false,
            index: true,
        },

        remarks: {
            type: String,
            trim: true,
            default: '',
        },

        edited_at: {
            type: Date,
            default: null,
            index: true,
        },

        edited_by: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
        },
    },
    {
        timestamps: true,
    }
);

// Compound index (optional but useful for scaling)
businessSchema.index({ business_name: 1, user_id: 1 });

module.exports = mongoose.model('Business', businessSchema);
