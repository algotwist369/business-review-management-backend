const mongoose = require('mongoose');
const { invoiceConnection } = require('../config/invoiceDb');

const InvoiceFolderSchema = new mongoose.Schema(
    {
        name: {
            type: String,
            required: [true, 'Folder name is required'],
            trim: true,
            maxlength: 120,
        },
        description: {
            type: String,
            trim: true,
            default: '',
        },
        parent_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'InvoiceFolder',
            default: null,
            index: true,
        },
        created_by: {
            user_id: {
                type: mongoose.Schema.Types.ObjectId,
                required: true,
            },
            username: { type: String, default: '' },
            role: { type: String, default: '' },
        },
        assigned_users: [
            {
                user_id: {
                    type: mongoose.Schema.Types.ObjectId,
                    required: true,
                },
                username: { type: String, default: '' },
                email: { type: String, default: '' },
                assigned_at: { type: Date, default: Date.now },
            },
        ],
        is_active: {
            type: Boolean,
            default: true,
        },
    },
    {
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    }
);

InvoiceFolderSchema.index({ parent_id: 1, is_active: 1 });
InvoiceFolderSchema.index({ 'assigned_users.user_id': 1, is_active: 1 });
InvoiceFolderSchema.index({ 'created_by.user_id': 1 });
InvoiceFolderSchema.index({ is_active: 1, created_at: -1 });

module.exports = invoiceConnection.model('InvoiceFolder', InvoiceFolderSchema);
