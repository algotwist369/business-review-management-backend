const mongoose = require('mongoose');
const messageSchema = require('./Message');

const NotificationSchema = new mongoose.Schema({
    user_id: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    
    message: [messageSchema],

    is_read: {
        type: Boolean,
        default: false,
    },
}, { timestamps: true });

module.exports = mongoose.model('Notification', NotificationSchema);