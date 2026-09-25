const mongoose = require('mongoose');
const InvoiceFolder = require('../models/invoiceFolderModel');
const InvoicePermission = require('../models/invoicePermissionModel');
const Invoice = require('../models/invoiceModel');
const User = require('../model/user');
const { logInvoiceActivity } = require('../services/invoiceAudit.service');
const { resolveFolderByIdOrPath, getAllDescendantFolderIds } = require('../utils/invoiceFolderHelper');

// Create new invoice folder or subfolder
const createFolder = async (req, res) => {
    try {
        const { name, description, parent_id } = req.body;

        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Folder name is required' });
        }

        let parentFolder = null;
        if (parent_id) {
            parentFolder = await InvoiceFolder.findById(parent_id);
            if (!parentFolder || !parentFolder.is_active) {
                return res.status(404).json({ error: 'Parent folder not found or inactive' });
            }
        }

        // Inherit assigned users from parent if subfolder
        const assigned_users = parentFolder && Array.isArray(parentFolder.assigned_users)
            ? [...parentFolder.assigned_users]
            : [];

        const folder = await InvoiceFolder.create({
            name: name.trim(),
            description: description ? description.trim() : '',
            parent_id: parentFolder ? parentFolder._id : null,
            created_by: {
                user_id: req.user._id,
                username: req.user.username || req.user.email,
                role: req.user.role,
            },
            assigned_users,
            is_active: true,
        });

        logInvoiceActivity({
            action: 'FOLDER_CREATED',
            user: req.user,
            folderId: folder._id,
            folderName: folder.name,
            details: { name: folder.name, description, parent_id: folder.parent_id },
            ipAddress: req.ip,
        });

        return res.status(201).json({ message: 'Folder created successfully', folder });
    } catch (err) {
        console.error('[InvoiceFolder] createFolder error:', err);
        return res.status(500).json({ error: 'Failed to create invoice folder' });
    }
};

// Ensure subfolders hierarchy during folder upload
const ensureSubfolders = async (req, res) => {
    try {
        const { parentFolderId, paths } = req.body;

        if (!parentFolderId || !Array.isArray(paths) || paths.length === 0) {
            return res.status(400).json({ error: 'parentFolderId and paths array are required' });
        }

        const rootParent = await InvoiceFolder.findById(parentFolderId);
        if (!rootParent || !rootParent.is_active) {
            return res.status(404).json({ error: 'Parent folder not found or inactive' });
        }

        const pathMap = {};
        const baseAssignedUsers = rootParent.assigned_users || [];

        // Sort paths by depth so parent directories are created first
        const sortedPaths = [...new Set(paths.map(p => p.trim()).filter(Boolean))]
            .sort((a, b) => a.split('/').length - b.split('/').length);

        for (const fullPath of sortedPaths) {
            const parts = fullPath.split('/').filter(Boolean);
            let currentParentId = rootParent._id;
            let currentAccPath = '';

            for (const part of parts) {
                currentAccPath = currentAccPath ? `${currentAccPath}/${part}` : part;

                if (pathMap[currentAccPath]) {
                    currentParentId = pathMap[currentAccPath];
                    continue;
                }

                let existing = await InvoiceFolder.findOne({
                    parent_id: currentParentId,
                    name: part,
                    is_active: true,
                });

                if (!existing) {
                    existing = await InvoiceFolder.create({
                        name: part,
                        parent_id: currentParentId,
                        created_by: {
                            user_id: req.user._id,
                            username: req.user.username || req.user.email,
                            role: req.user.role,
                        },
                        assigned_users: baseAssignedUsers,
                        is_active: true,
                    });

                    logInvoiceActivity({
                        action: 'FOLDER_CREATED',
                        user: req.user,
                        folderId: existing._id,
                        folderName: existing.name,
                        details: { name: existing.name, autoCreatedFromUpload: true },
                        ipAddress: req.ip,
                    });
                }

                pathMap[currentAccPath] = existing._id.toString();
                currentParentId = existing._id;
            }
        }

        return res.json({ folderMap: pathMap });
    } catch (err) {
        console.error('[InvoiceFolder] ensureSubfolders error:', err);
        return res.status(500).json({ error: 'Failed to ensure subfolders' });
    }
};

// Get folders accessible to current user
const getFolders = async (req, res) => {
    try {
        const userId = req.user._id;
        const role = req.user.role;
        const { parentId } = req.query;

        const parentFilter = {};
        if (parentId !== undefined) {
            if (parentId === 'root' || parentId === 'null' || parentId === '') {
                parentFilter.parent_id = null;
            } else if (parentId !== 'all') {
                parentFilter.parent_id = parentId;
            }
        }

        // 1. Super Admin sees all active folders
        if (role === 'super_admin') {
            const folders = await InvoiceFolder.find({ is_active: true, ...parentFilter }).sort({ created_at: -1 });
            return res.json({ folders });
        }

        // 2. Check CA permission
        const perm = await InvoicePermission.findOne({ user_id: userId });
        if (perm?.is_ca) {
            if (perm.folder_access_type === 'all') {
                const folders = await InvoiceFolder.find({ is_active: true, ...parentFilter }).sort({ created_at: -1 });
                return res.json({ folders, roleInInvoice: 'ca' });
            }
            if (perm.folder_access_type === 'custom') {
                const baseAllowedIds = (perm.allowed_folder_ids || []).map(id => id.toString());
                let allAccessibleIds = [...baseAllowedIds];
                for (const fId of baseAllowedIds) {
                    const descIds = await getAllDescendantFolderIds(fId);
                    allAccessibleIds.push(...descIds.map(d => d.toString()));
                }
                allAccessibleIds = [...new Set(allAccessibleIds)];

                const folders = await InvoiceFolder.find({
                    _id: { $in: allAccessibleIds },
                    is_active: true,
                    ...parentFilter,
                }).sort({ created_at: -1 });
                return res.json({ folders, roleInInvoice: 'ca' });
            }
        }

        // 3. Manager with can_manage_invoices
        if (perm?.can_manage_invoices) {
            const folders = await InvoiceFolder.find({ is_active: true, ...parentFilter }).sort({ created_at: -1 });
            return res.json({ folders, roleInInvoice: 'manager' });
        }

        // 4. Admin / User: Returns folders created by user OR assigned to user, plus their subfolders
        const baseFolders = await InvoiceFolder.find({
            is_active: true,
            $or: [
                { 'created_by.user_id': userId },
                { 'assigned_users.user_id': userId },
            ],
        }).select('_id');

        let allAccessibleUserFolderIds = baseFolders.map(f => f._id.toString());
        for (const fId of baseFolders.map(f => f._id)) {
            const descIds = await getAllDescendantFolderIds(fId);
            allAccessibleUserFolderIds.push(...descIds.map(d => d.toString()));
        }
        allAccessibleUserFolderIds = [...new Set(allAccessibleUserFolderIds)];

        const query = {
            is_active: true,
            ...parentFilter,
            _id: { $in: allAccessibleUserFolderIds },
        };

        const folders = await InvoiceFolder.find(query).sort({ created_at: -1 });
        return res.json({ folders, roleInInvoice: 'member' });
    } catch (err) {
        console.error('[InvoiceFolder] getFolders error:', err);
        return res.status(500).json({ error: 'Failed to fetch folders' });
    }
};

// Get folder by ID or path with its subfolders and breadcrumbs
const getFolderById = async (req, res) => {
    try {
        const { folderId } = req.params;
        const folder = await resolveFolderByIdOrPath(folderId);

        if (!folder || !folder.is_active) {
            return res.status(404).json({ error: 'Folder not found or inactive' });
        }

        // Subfolders of this folder
        const subfolders = await InvoiceFolder.find({
            parent_id: folder._id,
            is_active: true,
        }).sort({ name: 1 });

        // Build breadcrumbs up to root
        const breadcrumbs = [];
        let curr = folder;
        while (curr && curr.parent_id) {
            const parent = await InvoiceFolder.findById(curr.parent_id);
            if (parent && parent.is_active) {
                breadcrumbs.unshift({ _id: parent._id, name: parent.name });
                curr = parent;
            } else {
                break;
            }
        }
        breadcrumbs.push({ _id: folder._id, name: folder.name });

        // Add accumulated path to each breadcrumb for clean frontend routing:
        let accumulatedPath = '';
        const breadcrumbsWithPath = breadcrumbs.map(crumb => {
            accumulatedPath += (accumulatedPath ? '/' : '') + encodeURIComponent(crumb.name);
            return {
                _id: crumb._id,
                name: crumb.name,
                path: accumulatedPath,
            };
        });

        return res.json({ folder, subfolders, breadcrumbs: breadcrumbsWithPath });
    } catch (err) {
        console.error('[InvoiceFolder] getFolderById error:', err);
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

// Update folder details (Rename / Description edit)
const updateFolder = async (req, res) => {
    try {
        const { folderId } = req.params;
        const { name, description } = req.body;

        const folder = await InvoiceFolder.findById(folderId);
        if (!folder || !folder.is_active) {
            return res.status(404).json({ error: 'Folder not found' });
        }

        const userIdStr = (req.user._id || req.user.id || '').toString();
        const isSuperAdmin = req.user.role === 'super_admin';
        const isOwner = folder.created_by?.user_id?.toString() === userIdStr;
        const perm = await InvoicePermission.findOne({ user_id: req.user._id });
        const canManage = Boolean(perm?.can_manage_invoices);

        if (!isSuperAdmin && !isOwner && !canManage) {
            return res.status(403).json({ error: 'You do not have permission to edit this folder' });
        }

        if (name && name.trim()) folder.name = name.trim();
        if (typeof description === 'string') folder.description = description.trim();

        await folder.save();

        logInvoiceActivity({
            action: 'FOLDER_UPDATED',
            user: req.user,
            folderId: folder._id,
            folderName: folder.name,
            details: { updatedFields: { name: folder.name, description: folder.description } },
            ipAddress: req.ip,
        });

        return res.json({ message: 'Folder updated successfully', folder });
    } catch (err) {
        console.error('[InvoiceFolder] updateFolder error:', err);
        return res.status(500).json({ error: 'Failed to update folder' });
    }
};

// Soft delete folder and cascade delete all descendant subfolders, associated files and user access
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

        // Get all descendant subfolders recursively
        const descendantIds = await getAllDescendantFolderIds(folder._id);
        const allFolderIds = [folder._id, ...descendantIds];

        // 1. Cascade soft-delete all active invoices belonging to this folder and its subfolders into archive vault
        const updateResult = await Invoice.updateMany(
            { folder_id: { $in: allFolderIds }, is_deleted: false },
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

        // 2. Deactivate folder and all descendant subfolders
        await InvoiceFolder.updateMany(
            { _id: { $in: allFolderIds } },
            { $set: { is_active: false, assigned_users: [] } }
        );

        // 3. Revoke folder access from any CA or user permissions
        await InvoicePermission.updateMany(
            { allowed_folder_ids: { $in: allFolderIds } },
            { $pull: { allowed_folder_ids: { $in: allFolderIds } } }
        );

        logInvoiceActivity({
            action: 'FOLDER_DELETED',
            user: req.user,
            folderId: folder._id,
            folderName: folder.name,
            details: {
                folderName: folder.name,
                invoicesArchived: deletedFilesCount,
                subfoldersCount: descendantIds.length,
                accessRevoked: true,
            },
            ipAddress: req.ip,
        });

        return res.json({
            message: `Folder "${folder.name}" deleted successfully. All ${deletedFilesCount} associated files were archived.`,
            deletedFilesCount,
        });
    } catch (err) {
        console.error('[InvoiceFolder] deleteFolder error:', err);
        return res.status(500).json({ error: 'Failed to delete folder' });
    }
};

module.exports = {
    createFolder,
    ensureSubfolders,
    getFolders,
    getFolderById,
    assignUsersToFolder,
    removeUserFromFolder,
    updateFolder,
    deleteFolder,
    resolveFolderByIdOrPath,
};
