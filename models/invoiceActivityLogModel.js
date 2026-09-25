const mongoose = require('mongoose');
const { invoiceConnection } = require('../config/invoiceDb');

const InvoiceActivityLogSchema = new mongoose.Schema(
    {
        action: {
            type: String,
            required: true,
            enum: [
                'FOLDER_CREATED',
                'FOLDER_UPDATED',
                'FOLDER_DELETED',
                'FOLDER_ASSIGNED',
                'INVOICE_UPLOADED',
                'INVOICE_DELETED',
                'INVOICE_RESTORED',
                'INVOICE_PURGED',
                'INVOICES_BATCH_DELETED',
                'INVOICES_BATCH_PURGED',
                'INVOICES_BATCH_RESTORED',
                'PERMISSION_GRANTED',
                'PERMISSION_REVOKED',
                'CA_EXPORT_DOWNLOADED',
                'INVOICE_VIEWED',
                'INVOICE_DOWNLOADED',
                'INVOICES_BATCH_DOWNLOADED',
            ],
            index: true,
        },
        performed_by: {
            user_id: {
                type: mongoose.Schema.Types.ObjectId,
                required: true,
            },
            username: { type: String, default: '' },
            email: { type: String, default: '' },
            role: { type: String, default: '' },
        },
        folder_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'InvoiceFolder',
            default: null,
        },
        folder_name: {
            type: String,
            default: '',
        },
        invoice_id: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Invoice',
            default: null,
        },
        invoice_name: {
            type: String,
            default: '',
        },
        details: {
            type: mongoose.Schema.Types.Mixed,
            default: {},
        },
        ip_address: {
            type: String,
            default: '',
        },
        created_at: {
            type: Date,
            default: Date.now,
        },
    },
    {
        timestamps: false,
    }
);

// MongoDB TTL Index: Auto-deletes logs after 30 days (2,592,000 seconds)
InvoiceActivityLogSchema.index({ created_at: 1 }, { expireAfterSeconds: 30 * 24 * 60 * 60 });
InvoiceActivityLogSchema.index({ 'performed_by.user_id': 1, created_at: -1 });
InvoiceActivityLogSchema.index({ folder_id: 1, created_at: -1 });

module.exports = invoiceConnection.model('InvoiceActivityLog', InvoiceActivityLogSchema);
