const InvoiceActivityLog = require('../models/invoiceActivityLogModel');

/**
 * Asynchronously record invoice management activity without blocking HTTP responses
 */
const logInvoiceActivity = ({
    action,
    user,
    folderId = null,
    folderName = '',
    invoiceId = null,
    invoiceName = '',
    details = {},
    ipAddress = '',
}) => {
    // Fire and forget via setImmediate to keep event loop free
    setImmediate(async () => {
        try {
            await InvoiceActivityLog.create({
                action,
                performed_by: {
                    user_id: user?._id || user?.id,
                    username: user?.username || user?.email || 'Unknown',
                    email: user?.email || '',
                    role: user?.role || 'user',
                },
                folder_id: folderId,
                folder_name: folderName,
                invoice_id: invoiceId,
                invoice_name: invoiceName,
                details,
                ip_address: ipAddress,
                created_at: new Date(),
            });
        } catch (err) {
            console.error('[InvoiceAudit] Failed to log activity:', err.message);
        }
    });
};

module.exports = {
    logInvoiceActivity,
};
