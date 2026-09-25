const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const {
    requireInvoiceManagementAccess,
    requireFolderAccess,
} = require('../middlewares/invoiceAccess.middleware');
const folderController = require('../controllers/invoiceFolderController');

router.use(authMiddleware);

// Folder creation (Admin with grant or Super Admin)
router.post('/', requireInvoiceManagementAccess, folderController.createFolder);

// List accessible folders
router.get('/', folderController.getFolders);

// Folder detail
router.get('/:folderId', requireFolderAccess('read'), folderController.getFolderById);

// Update folder
router.put('/:folderId', requireInvoiceManagementAccess, folderController.updateFolder);

// Soft delete folder
router.delete('/:folderId', requireInvoiceManagementAccess, folderController.deleteFolder);

// Team assignment endpoints
router.post('/:folderId/assign', requireInvoiceManagementAccess, folderController.assignUsersToFolder);
router.delete('/:folderId/assign/:userId', requireInvoiceManagementAccess, folderController.removeUserFromFolder);

module.exports = router;
