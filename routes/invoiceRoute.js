const express = require('express');
const router = express.Router();
const authMiddleware = require('../middlewares/auth.middleware');
const {
    requireSuperAdmin,
    requireFolderAccess,
} = require('../middlewares/invoiceAccess.middleware');
const invoiceController = require('../controllers/invoiceController');

router.use(authMiddleware);

// 1. Upload Pipeline
router.post('/batch-presign', requireFolderAccess('write'), invoiceController.batchPresignUpload);
router.post('/confirm-upload', requireFolderAccess('write'), invoiceController.confirmBatchUpload);

// 2. Query & Viewing
router.get('/', invoiceController.getInvoices);
router.get('/:invoiceId/view', invoiceController.getInvoiceViewUrl);
router.get('/:invoiceId/download', invoiceController.getInvoiceDownloadUrl);
router.post('/batch-download', invoiceController.getBatchDownloadUrls);

// 3. Soft Delete with Mandatory Reason
router.post('/batch-delete', invoiceController.batchSoftDeleteInvoices);
router.delete('/:invoiceId', invoiceController.softDeleteInvoice);

// 4. Super Admin Archive Vault & Purge
router.get('/archive/vault', requireSuperAdmin, invoiceController.getArchiveVault);
router.post('/archive/:invoiceId/restore', requireSuperAdmin, invoiceController.restoreInvoice);
router.delete('/archive/:invoiceId/purge', requireSuperAdmin, invoiceController.purgeInvoicePermanently);

module.exports = router;
