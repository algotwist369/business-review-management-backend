const InvoicePermission = require('../models/invoicePermissionModel');
const User = require('../model/user');
const { logInvoiceActivity } = require('../services/invoiceAudit.service');

// Get all invoice permissions (Super Admin only)
const getAllPermissions = async (req, res) => {
    try {
        const permissions = await InvoicePermission.find()
            .populate('allowed_folder_ids', 'name is_active')
            .sort({ updated_at: -1 });

        return res.json({ permissions });
    } catch (err) {
        console.error('[InvoicePerm] getAllPermissions error:', err);
        return res.status(500).json({ error: 'Failed to fetch invoice permissions' });
    }
};

// Get current user's invoice permission
const getMyPermission = async (req, res) => {
    try {
        if (req.user?.role === 'super_admin') {
            return res.json({
                permission: {
                    can_manage_invoices: true,
                    is_super_admin: true,
                    is_ca: false,
                    folder_access_type: 'all',
                },
            });
        }

        const perm = await InvoicePermission.findOne({ user_id: req.user._id })
            .populate('allowed_folder_ids', 'name is_active');

        return res.json({
            permission: perm || {
                can_manage_invoices: false,
                is_ca: false,
                folder_access_type: 'none',
                allowed_folder_ids: [],
            },
        });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to fetch current user permissions' });
    }
};

// Grant or update user invoice permissions (Super Admin only)
const upsertPermission = async (req, res) => {
    try {
        const { userId, canManageInvoices, isCa, folderAccessType, allowedFolderIds } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        const targetUser = await User.findById(userId).select('username email role');
        if (!targetUser) {
            return res.status(404).json({ error: 'Target user not found' });
        }

        const updated = await InvoicePermission.findOneAndUpdate(
            { user_id: userId },
            {
                user_id: userId,
                user_email: targetUser.email,
                user_name: targetUser.username,
                user_role: targetUser.role,
                can_manage_invoices: Boolean(canManageInvoices),
                is_ca: Boolean(isCa),
                folder_access_type: folderAccessType || 'none',
                allowed_folder_ids: Array.isArray(allowedFolderIds) ? allowedFolderIds : [],
                granted_by: {
                    user_id: req.user._id,
                    username: req.user.username || req.user.email,
                },
            },
            { upsert: true, new: true }
        );

        logInvoiceActivity({
            action: 'PERMISSION_GRANTED',
            user: req.user,
            details: {
                targetUser: targetUser.email,
                canManageInvoices,
                isCa,
                folderAccessType,
            },
            ipAddress: req.ip,
        });

        return res.json({ message: 'Permissions updated successfully', permission: updated });
    } catch (err) {
        console.error('[InvoicePerm] upsertPermission error:', err);
        return res.status(500).json({ error: 'Failed to update permissions' });
    }
};

// Revoke user invoice permission (Super Admin only)
const revokePermission = async (req, res) => {
    try {
        const { userId } = req.params;

        const deleted = await InvoicePermission.findOneAndDelete({ user_id: userId });

        logInvoiceActivity({
            action: 'PERMISSION_REVOKED',
            user: req.user,
            details: { targetUserId: userId },
            ipAddress: req.ip,
        });

        return res.json({ message: 'Permission revoked successfully', revoked: !!deleted });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to revoke permissions' });
    }
};

module.exports = {
    getAllPermissions,
    getMyPermission,
    upsertPermission,
    revokePermission,
};
