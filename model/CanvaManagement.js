const mongoose = require('mongoose');
const MessageSchema = require('./Message');
const AssetSchema = require('./Asset');

const CanvaManagementSchema = new mongoose.Schema({
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

    logo: AssetSchema,

    fav_icon: AssetSchema,

    banner: AssetSchema,

    offer_card: AssetSchema,

    visit_card: AssetSchema,

    message: [MessageSchema],

}, { timestamps: true });

CanvaManagementSchema.index(
    { user_id: 1, business_id: 1 },
    { unique: true }
);

module.exports = mongoose.model('CanvaManagement', CanvaManagementSchema);