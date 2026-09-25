const InvoiceFolder = require('../models/invoiceFolderModel');
const InvoicePermission = require('../models/invoicePermissionModel');
const Invoice = require('../models/invoiceModel');
const User = require('../model/user');
const { logInvoiceActivity } = require('../services/invoiceAudit.service');

// Create new invoice folder (Admin with grant or Super Admin)
const createFolder = async (req, res) => {
    try {
        const { name, description } = req.body;

        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Folder name is required' });
        }

        const folder = await InvoiceFolder.create({
            name: name.trim(),
            description: description ? description.trim() : '',
            created_by: {
                user_id: req.user._id,
                username: req.user.username || req.user.email,
                role: req.user.role,
            },
            assigned_users: [],
            is_active: true,
        });

        logInvoiceActivity({
            action: 'FOLDER_CREATED',
            user: req.user,
            folderId: folder._id,
            folderName: folder.name,
            details: { name: folder.name, description },
            ipAddress: req.ip,
        });

        return res.status(201).json({ message: 'Folder created successfully', folder });
    } catch (err) {
        console.error('[InvoiceFolder] createFolder error:', err);
        return res.status(500).json({ error: 'Failed to create invoice folder' });
    }
};

// Get folders accessible to current user
const getFolders = async (req, res) => {
    try {
        const userId = req.user._id;
        const role = req.user.role;

        // 1. Super Admin sees all active folders
        if (role === 'super_admin') {
            const folders = await InvoiceFolder.find({ is_active: true }).sort({ created_at: -1 });
            return res.json({ folders });
        }

        // 2. Check CA permission
        const perm = await InvoicePermission.findOne({ user_id: userId });
        if (perm?.is_ca) {
            if (perm.folder_access_type === 'all') {
                const folders = await InvoiceFolder.find({ is_active: true }).sort({ created_at: -1 });
                return res.json({ folders, roleInInvoice: 'ca' });
            }
            if (perm.folder_access_type === 'custom') {
                const folders = await InvoiceFolder.find({
                    _id: { $in: perm.allowed_folder_ids },
                    is_active: true,
                }).sort({ created_at: -1 });
                return res.json({ folders, roleInInvoice: 'ca' });
            }
        }

        // 3. Admin / User: Returns folders created by user OR assigned to user
        const query = {
            is_active: true,
            $or: [
                { 'created_by.user_id': userId },
                { 'assigned_users.user_id': userId },
            ],
        };

        const folders = await InvoiceFolder.find(query).sort({ created_at: -1 });
        return res.json({ folders, roleInInvoice: perm?.can_manage_invoices ? 'manager' : 'member' });
    } catch (err) {
        console.error('[InvoiceFolder] getFolders error:', err);
        return res.status(500).json({ error: 'Failed to fetch folders' });
    }
};

// Get folder by ID
const getFolderById = async (req, res) => {
    try {
        const { folderId } = req.params;
        const folder = req.currentFolder || await InvoiceFolder.findById(folderId);

        if (!folder || !folder.is_active) {
            return res.status(404).json({ error: 'Folder not found or inactive' });
        }

        return res.json({ folder });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to fetch folder details' });
    }
};

// Assign users/team to a folder (Admin or Super Admin)
const assignUsersToFolder = async (req, res) => {
    try {
        const { folderId } = req.params;
        const { userIds } = req.body; // Array of user IDs

        if (!Array.isArray(userIds) || userIds.length === 0) {
            return res.status(400).json({ error: 'userIds array is required' });
        }

        const folder = await InvoiceFolder.findById(folderId);
        if (!folder || !folder.is_active) {
            return res.status(404).json({ error: 'Folder not found' });
        }

        // Fetch users details
        const users = await User.find({ _id: { $in: userIds } }).select('_id username email');

        const existingIds = new Set(folder.assigned_users.map(u => u.user_id.toString()));

        const newAssignments = [];
        users.forEach(u => {
            if (!existingIds.has(u._id.toString())) {
                newAssignments.push({
                    user_id: u._id,
                    username: u.username,
                    email: u.email,
                    assigned_at: new Date(),
                });
            }
        });

        folder.assigned_users.push(...newAssignments);
        await folder.save();

        logInvoiceActivity({
            action: 'FOLDER_ASSIGNED',
            user: req.user,
            folderId: folder._id,
            folderName: folder.name,
            details: { assignedUsers: users.map(u => u.email) },
            ipAddress: req.ip,
        });

        return res.json({ message: 'Users assigned to folder successfully', folder });
    } catch (err) {
        console.error('[InvoiceFolder] assignUsersToFolder error:', err);
        return res.status(500).json({ error: 'Failed to assign users to folder' });
    }
};

// Remove assigned user from folder
const removeUserFromFolder = async (req, res) => {
    try {
        const { folderId, userId } = req.params;

        const folder = await InvoiceFolder.findById(folderId);
        if (!folder) {
            return res.status(404).json({ error: 'Folder not found' });
        }

        folder.assigned_users = folder.assigned_users.filter(u => u.user_id.toString() !== userId);
        await folder.save();

        logInvoiceActivity({
            action: 'FOLDER_UPDATED',
            user: req.user,
            folderId: folder._id,
            folderName: folder.name,
            details: { removedUserId: userId },
            ipAddress: req.ip,
        });

        return res.json({ message: 'User removed from folder', folder });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to remove user from folder' });
    }
};

// Update folder details
const updateFolder = async (req, res) => {
    try {
        const { folderId } = req.params;
        const { name, description } = req.body;

        const folder = await InvoiceFolder.findById(folderId);
        if (!folder || !folder.is_active) {
            return res.status(404).json({ error: 'Folder not found' });
        }

        if (name) folder.name = name.trim();
        if (typeof description === 'string') folder.description = description.trim();

        await folder.save();

        logInvoiceActivity({
            action: 'FOLDER_UPDATED',
            user: req.user,
            folderId: folder._id,
            folderName: folder.name,
            details: { updatedFields: { name, description } },
            ipAddress: req.ip,
        });

        return res.json({ message: 'Folder updated successfully', folder });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to update folder' });
    }
};

// Soft delete folder and cascade delete all associated files and user access
const deleteFolder = async (req, res) => {
    try {
        const { folderId } = req.params;

        const folder = await InvoiceFolder.findById(folderId);
        if (!folder || !folder.is_active) {
            return res.status(404).json({ error: 'Folder not found or already deleted' });
        }

        // Authorization: Only Super Admin or the creator of the folder can delete it
        const userIdStr = (req.user._id || req.user.id || '').toString();
        const isSuperAdmin = req.user.role === 'super_admin';
        const isOwner = folder.created_by?.user_id?.toString() === userIdStr;

        if (!isSuperAdmin && !isOwner) {
            return res.status(403).json({
                error: 'You do not have permission to delete this folder. Only the folder creator or Super Admin can delete it.',
            });
        }

        // 1. Cascade soft-delete all active invoices belonging to this folder into the archive vault
        const updateResult = await Invoice.updateMany(
            { folder_id: folder._id, is_deleted: false },
            {
                $set: {
                    is_deleted: true,
                    deletion_meta: {
                        deleted_by: {
                            user_id: req.user._id,
                            username: req.user.username || req.user.email,
                            role: req.user.role,
                        },
                        deleted_at: new Date(),
                        delete_reason: `Folder deleted: ${folder.name}`,
                    },
                },
            }
        );

        const deletedFilesCount = updateResult.modifiedCount || 0;

        // 2. Deactivate folder and clear all assigned team users
        folder.is_active = false;
        folder.assigned_users = [];
        await folder.save();

        // 3. Revoke folder access from any CA or user permissions
        await InvoicePermission.updateMany(
            { allowed_folder_ids: folder._id },
            { $pull: { allowed_folder_ids: folder._id } }
        );

        logInvoiceActivity({
            action: 'FOLDER_DELETED',
            user: req.user,
            folderId: folder._id,
            folderName: folder.name,
            details: {
                folderName: folder.name,
                invoicesArchived: deletedFilesCount,
                accessRevoked: true,
            },
            ipAddress: req.ip,
        });

        return res.json({
            message: `Folder "${folder.name}" deleted successfully. All ${deletedFilesCount} associated files were archived and user access was revoked.`,
            deletedFilesCount,
        });
    } catch (err) {
        console.error('[InvoiceFolder] deleteFolder error:', err);
        return res.status(500).json({ error: 'Failed to delete folder' });
    }
};

module.exports = {
    createFolder,
    getFolders,
    getFolderById,
    assignUsersToFolder,
    removeUserFromFolder,
    updateFolder,
    deleteFolder,
};
