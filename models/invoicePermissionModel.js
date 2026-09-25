const mongoose = require('mongoose');
const { invoiceConnection } = require('../config/invoiceDb');

const InvoicePermissionSchema = new mongoose.Schema(
    {
        user_id: {
            type: mongoose.Schema.Types.ObjectId,
            required: true,
            unique: true,
            index: true,
        },
        user_email: { type: String, default: '' },
        user_name: { type: String, default: '' },
        user_role: { type: String, default: 'user' },
        
        // Permissions
        can_manage_invoices: {
            type: Boolean,
            default: false, // Super Admin grants this to Admin to create/manage folders
        },
        is_ca: {
            type: Boolean,
            default: false, // CA / Auditor Read-Only access
        },
        folder_access_type: {
            type: String,
            enum: ['all', 'custom', 'none'],
            default: 'none',
        },
        allowed_folder_ids: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'InvoiceFolder',
            },
        ],
        granted_by: {
            user_id: mongoose.Schema.Types.ObjectId,
            username: String,
        },
    },
    {
        timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    }
);

InvoicePermissionSchema.index({ user_id: 1 }, { unique: true });
InvoicePermissionSchema.index({ is_ca: 1 });
InvoicePermissionSchema.index({ can_manage_invoices: 1 });

module.exports = invoiceConnection.model('InvoicePermission', InvoicePermissionSchema);
