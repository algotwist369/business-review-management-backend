const mongoose = require('mongoose');
const { invoiceConnection } = require('../config/invoiceDb');

const InvoiceSchema = new mongoose.Schema(
    {
        folder_id: {
            type: mongoose.Schema.Types.ObjectId,
            required: [true, 'Folder ID is required'],
            ref: 'InvoiceFolder',
        },
        file_name: {
            type: String,
            required: [true, 'File name is required'],
            trim: true,
        },
        stored_s3_key: {
            type: String,
            required: [true, 'S3 key is required'],
            trim: true,
        },
        s3_bucket: {
            type: String,
            required: true,
        },
        file_size_bytes: {
            type: Number,
            required: true,
            default: 0,
        },
        original_size_bytes: {
            type: Number,
            default: 0,
        },
        mime_type: {
            type: String,
            default: 'application/pdf',
        },
        invoice_date: {
            type: Date,
            default: Date.now,
        },
        year: {
            type: Number,
            required: true,
            index: true,
        },
        month: {
            type: Number, // 1 to 12
            required: true,
            index: true,
        },
        category: {
            type: String,
            trim: true,
            default: 'General',
            index: true,
        },
        file_hash: {
            type: String,
            trim: true,
            default: '',
            index: true,
        },
        uploaded_by: {
            user_id: {
                type: mongoose.Schema.Types.ObjectId,
                required: true,
            },
            username: { type: String, default: '' },
            email: { type: String, default: '' },
            role: { type: String, default: '' },
        },
        is_deleted: {
            type: Boolean,
            default: false,
            index: true,
        },
        deletion_meta: {
            deleted_by: {
                user_id: mongoose.Schema.Types.ObjectId,
                username: String,
                role: String,
            },
            deleted_at: Date,
            delete_reason: {
                type: String,
                trim: true,
                default: '',
            },
        },
    },
    {
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    }
);

// High-performance compound indexes
InvoiceSchema.index({ folder_id: 1, is_deleted: 1, year: -1, month: -1 });
InvoiceSchema.index({ folder_id: 1, is_deleted: 1, created_at: -1 });
InvoiceSchema.index({ folder_id: 1, category: 1, is_deleted: 1 });
InvoiceSchema.index({ folder_id: 1, file_hash: 1, is_deleted: 1 });
InvoiceSchema.index({ is_deleted: 1, 'deletion_meta.deleted_at': -1 });
InvoiceSchema.index({ year: 1, month: 1, is_deleted: 1 });

module.exports = invoiceConnection.model('Invoice', InvoiceSchema);
