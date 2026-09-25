const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const {
    requireInvoiceManagementAccess,
    requireFolderAccess,
    requireFolderCreateAccess,
} = require('../middlewares/invoiceAccess.middleware');
const folderController = require('../controllers/invoiceFolderController');

router.use(authMiddleware);

// Folder creation (Admin with grant, Super Admin, or user with access to parent folder)
router.post('/', requireFolderCreateAccess, folderController.createFolder);

// Ensure subfolders tree for bulk directory upload
router.post('/ensure-subfolders', requireFolderCreateAccess, folderController.ensureSubfolders);

// List accessible folders
router.get('/', folderController.getFolders);

// Folder detail
router.get('/:folderId', requireFolderAccess('read'), folderController.getFolderById);

// Update/Rename folder
router.put('/:folderId', requireFolderAccess('write'), folderController.updateFolder);

// Soft delete folder
router.delete('/:folderId', requireInvoiceManagementAccess, folderController.deleteFolder);

// Team assignment endpoints
router.post('/:folderId/assign', requireInvoiceManagementAccess, folderController.assignUsersToFolder);
router.delete('/:folderId/assign/:userId', requireInvoiceManagementAccess, folderController.removeUserFromFolder);

module.exports = router;
