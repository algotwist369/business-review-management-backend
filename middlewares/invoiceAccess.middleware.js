const InvoicePermission = require('../models/invoicePermissionModel');
const InvoiceFolder = require('../models/invoiceFolderModel');

/**
 * Ensures user is Super Admin
 */
const requireSuperAdmin = (req, res, next) => {
    if (req.user?.role !== 'super_admin') {
        return res.status(403).json({ error: 'Super Admin access required' });
    }
    next();
};

/**
 * Checks if user is Super Admin or an Admin/User granted 'can_manage_invoices'
 */
const requireInvoiceManagementAccess = async (req, res, next) => {
    try {
        if (req.user?.role === 'super_admin') {
            return next();
        }

        const perm = await InvoicePermission.findOne({ user_id: req.user._id });
        if (perm?.can_manage_invoices) {
            req.invoicePermission = perm;
            return next();
        }

        return res.status(403).json({ error: 'Access denied: Invoice management permission required' });
    } catch (err) {
        return res.status(500).json({ error: 'Error checking invoice permissions' });
    }
};

/**
 * Validates if the user can view, upload, or interact with a specific folder
 */
const requireFolderAccess = (actionType = 'read') => {
    return async (req, res, next) => {
        try {
            const folderId = req.params.folderId || req.body.folderId || req.query.folderId;
            if (!folderId) {
                return res.status(400).json({ error: 'Folder ID is required' });
            }

            if (req.user?.role === 'super_admin') {
                return next();
            }

            const folder = await InvoiceFolder.findById(folderId);
            if (!folder || !folder.is_active) {
                return res.status(404).json({ error: 'Folder not found or inactive' });
            }

            const userIdStr = req.user._id.toString();

            // 1. Is folder creator?
            if (folder.created_by?.user_id?.toString() === userIdStr) {
                req.currentFolder = folder;
                return next();
            }

            // 2. Is assigned user?
            const isAssigned = folder.assigned_users.some(u => u.user_id?.toString() === userIdStr);
            if (isAssigned) {
                req.currentFolder = folder;
                return next();
            }

            // 3. Is CA with read access?
            const perm = await InvoicePermission.findOne({ user_id: req.user._id });
            if (perm?.is_ca) {
                if (actionType === 'write') {
                    return res.status(403).json({ error: 'CA accounts have read-only access' });
                }

                if (perm.folder_access_type === 'all') {
                    req.currentFolder = folder;
                    return next();
                }

                if (perm.folder_access_type === 'custom') {
                    const isAllowed = perm.allowed_folder_ids.some(id => id.toString() === folderId.toString());
                    if (isAllowed) {
                        req.currentFolder = folder;
                        return next();
                    }
                }
            }

            return res.status(403).json({ error: 'You do not have access to this invoice folder' });
        } catch (err) {
            console.error('[InvoiceAuth] requireFolderAccess error:', err);
            return res.status(500).json({ error: 'Failed to verify folder authorization' });
        }
    };
};

module.exports = {
    requireSuperAdmin,
    requireInvoiceManagementAccess,
    requireFolderAccess,
};
