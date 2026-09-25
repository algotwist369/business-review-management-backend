const Invoice = require('../models/invoiceModel');
const InvoiceFolder = require('../models/invoiceFolderModel');
const s3Service = require('../services/s3.service');
const { logInvoiceActivity } = require('../services/invoiceAudit.service');

// 1. Batch Pre-signed URLs for up to 200 files (Super fast, <15ms)
const batchPresignUpload = async (req, res) => {
    try {
        const { folderId, files } = req.body;

        if (!folderId) {
            return res.status(400).json({ error: 'Folder ID is required' });
        }

        if (!Array.isArray(files) || files.length === 0) {
            return res.status(400).json({ error: 'Files array is required' });
        }

        if (files.length > 200) {
            return res.status(400).json({ error: 'Maximum 200 files can be uploaded at once' });
        }

        const presignedFiles = await s3Service.getBatchPresignedUploadUrls({
            folderId,
            files,
        });

        return res.json({
            folderId,
            files: presignedFiles,
        });
    } catch (err) {
        console.error('[Invoice] batchPresignUpload error:', err);
        return res.status(500).json({ error: 'Failed to generate pre-signed upload URLs' });
    }
};

// 2. Batch Confirmation of Uploaded Invoices into MongoDB
const confirmBatchUpload = async (req, res) => {
    try {
        const { folderId, uploadedFiles } = req.body;

        if (!folderId || !Array.isArray(uploadedFiles) || uploadedFiles.length === 0) {
            return res.status(400).json({ error: 'Invalid upload confirmation payload' });
        }

        const folder = await InvoiceFolder.findById(folderId);
        if (!folder) {
            return res.status(404).json({ error: 'Folder not found' });
        }

        const documents = uploadedFiles.map((file) => {
            const dateObj = file.invoiceDate ? new Date(file.invoiceDate) : new Date();
            const year = isNaN(dateObj.getFullYear()) ? new Date().getFullYear() : dateObj.getFullYear();
            const month = isNaN(dateObj.getMonth()) ? new Date().getMonth() + 1 : dateObj.getMonth() + 1;

            return {
                folder_id: folderId,
                file_name: file.fileName,
                stored_s3_key: file.s3Key,
                s3_bucket: file.bucket || s3Service.bucketName,
                file_size_bytes: file.fileSizeBytes || 0,
                original_size_bytes: file.originalSizeBytes || file.fileSizeBytes || 0,
                mime_type: file.mimeType || 'application/pdf',
                invoice_date: isNaN(dateObj.getTime()) ? new Date() : dateObj,
                year,
                month,
                uploaded_by: {
                    user_id: req.user._id,
                    username: req.user.username || req.user.email,
                    email: req.user.email,
                    role: req.user.role,
                },
                is_deleted: false,
            };
        });

        const createdInvoices = await Invoice.insertMany(documents);

        logInvoiceActivity({
            action: 'INVOICE_UPLOADED',
            user: req.user,
            folderId: folder._id,
            folderName: folder.name,
            details: {
                count: createdInvoices.length,
                fileNames: createdInvoices.map(i => i.file_name).slice(0, 10),
            },
            ipAddress: req.ip,
        });

        return res.status(201).json({
            message: `Successfully uploaded and saved ${createdInvoices.length} invoices`,
            count: createdInvoices.length,
            invoices: createdInvoices,
        });
    } catch (err) {
        console.error('[Invoice] confirmBatchUpload error:', err);
        return res.status(500).json({ error: 'Failed to record uploaded invoices' });
    }
};

// 3. Get Active Invoices in Folder (or across folders for CA) with Date/Month/Year filters
const getInvoices = async (req, res) => {
    try {
        const {
            folderId,
            year,
            month,
            startDate,
            endDate,
            search,
            page = 1,
            limit = 50,
        } = req.query;

        const filter = { is_deleted: false };

        if (folderId) {
            filter.folder_id = folderId;
        }

        if (year) {
            filter.year = parseInt(year, 10);
        }

        if (month) {
            filter.month = parseInt(month, 10);
        }

        if (startDate || endDate) {
            filter.invoice_date = {};
            if (startDate) filter.invoice_date.$gte = new Date(startDate);
            if (endDate) filter.invoice_date.$lte = new Date(endDate);
        }

        if (search) {
            filter.file_name = { $regex: search.trim(), $options: 'i' };
        }

        const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
        const pageSize = Math.min(200, Math.max(1, parseInt(limit, 10)));

        const [invoices, total] = await Promise.all([
            Invoice.find(filter)
                .populate('folder_id', 'name')
                .sort({ invoice_date: -1, created_at: -1 })
                .skip(skip)
                .limit(pageSize),
            Invoice.countDocuments(filter),
        ]);

        return res.json({
            invoices,
            total,
            page: parseInt(page, 10),
            totalPages: Math.ceil(total / pageSize),
        });
    } catch (err) {
        console.error('[Invoice] getInvoices error:', err);
        return res.status(500).json({ error: 'Failed to fetch invoices' });
    }
};

// 4. Secure Presigned URL for in-browser Preview (PDF / Image)
const getInvoiceViewUrl = async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const invoice = await Invoice.findById(invoiceId);

        if (!invoice || invoice.is_deleted) {
            return res.status(404).json({ error: 'Invoice not found or archived' });
        }

        const viewUrl = await s3Service.getPresignedViewUrl(invoice.stored_s3_key);
        return res.json({ viewUrl, fileName: invoice.file_name, mimeType: invoice.mime_type });
    } catch (err) {
        console.error('[Invoice] getInvoiceViewUrl error:', err);
        return res.status(500).json({ error: 'Failed to generate preview URL' });
    }
};

// 5. Secure Presigned URL for File Download
const getInvoiceDownloadUrl = async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const invoice = await Invoice.findById(invoiceId);

        if (!invoice || invoice.is_deleted) {
            return res.status(404).json({ error: 'Invoice not found or archived' });
        }

        const downloadUrl = await s3Service.getPresignedDownloadUrl(invoice.stored_s3_key, invoice.file_name);
        return res.json({ downloadUrl, fileName: invoice.file_name });
    } catch (err) {
        console.error('[Invoice] getInvoiceDownloadUrl error:', err);
        return res.status(500).json({ error: 'Failed to generate download URL' });
    }
};

// 6. Batch Download URLs for CA / Auditor (up to 200 files)
const getBatchDownloadUrls = async (req, res) => {
    try {
        const { invoiceIds } = req.body;

        if (!Array.isArray(invoiceIds) || invoiceIds.length === 0) {
            return res.status(400).json({ error: 'invoiceIds array is required' });
        }

        const invoices = await Invoice.find({
            _id: { $in: invoiceIds },
            is_deleted: false,
        }).select('_id file_name stored_s3_key mime_type file_size_bytes');

        const downloadList = await Promise.all(
            invoices.map(async (inv) => {
                const downloadUrl = await s3Service.getPresignedDownloadUrl(inv.stored_s3_key, inv.file_name);
                return {
                    id: inv._id,
                    fileName: inv.file_name,
                    downloadUrl,
                    mimeType: inv.mime_type,
                    fileSize: inv.file_size_bytes,
                };
            })
        );

        logInvoiceActivity({
            action: 'CA_EXPORT_DOWNLOADED',
            user: req.user,
            details: { count: downloadList.length },
            ipAddress: req.ip,
        });

        return res.json({ files: downloadList });
    } catch (err) {
        return res.status(500).json({ error: 'Failed to generate batch download URLs' });
    }
};

// 7. Soft Delete Invoice with MANDATORY REASON (Hidden from User & Admin; Sent to Archive Vault)
const softDeleteInvoice = async (req, res) => {
    try {
        const { invoiceId } = req.params;
        const { reason } = req.body;

        if (!reason || reason.trim().length < 3) {
            return res.status(400).json({ error: 'A mandatory reason is required to delete this invoice' });
        }

        const invoice = await Invoice.findById(invoiceId).populate('folder_id');
        if (!invoice) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        if (invoice.is_deleted) {
            return res.status(400).json({ error: 'Invoice is already archived' });
        }

        // Authorization check: Super Admin, Folder Creator/Manager, or Uploader
        const userIdStr = req.user._id.toString();
        const isSuperAdmin = req.user.role === 'super_admin';
        const isUploader = invoice.uploaded_by?.user_id?.toString() === userIdStr;
        const isFolderOwner = invoice.folder_id?.created_by?.user_id?.toString() === userIdStr;

        if (!isSuperAdmin && !isUploader && !isFolderOwner) {
            return res.status(403).json({ error: 'You do not have permission to delete this invoice' });
        }

        invoice.is_deleted = true;
        invoice.deletion_meta = {
            deleted_by: {
                user_id: req.user._id,
                username: req.user.username || req.user.email,
                role: req.user.role,
            },
            deleted_at: new Date(),
            delete_reason: reason.trim(),
        };

        await invoice.save();

        logInvoiceActivity({
            action: 'INVOICE_DELETED',
            user: req.user,
            folderId: invoice.folder_id?._id,
            folderName: invoice.folder_id?.name || '',
            invoiceId: invoice._id,
            invoiceName: invoice.file_name,
            details: { reason: reason.trim() },
            ipAddress: req.ip,
        });

        return res.json({ message: 'Invoice deleted successfully' });
    } catch (err) {
        console.error('[Invoice] softDeleteInvoice error:', err);
        return res.status(500).json({ error: 'Failed to delete invoice' });
    }
};

// 8. Super Admin Archive Vault (All Soft-Deleted Invoices + Reasons)
const getArchiveVault = async (req, res) => {
    try {
        const { search, page = 1, limit = 50 } = req.query;

        const filter = { is_deleted: true };

        if (search) {
            filter.$or = [
                { file_name: { $regex: search.trim(), $options: 'i' } },
                { 'deletion_meta.delete_reason': { $regex: search.trim(), $options: 'i' } },
                { 'deletion_meta.deleted_by.username': { $regex: search.trim(), $options: 'i' } },
            ];
        }

        const skip = (Math.max(1, parseInt(page, 10)) - 1) * parseInt(limit, 10);
        const pageSize = Math.min(200, Math.max(1, parseInt(limit, 10)));

        const [archivedInvoices, total] = await Promise.all([
            Invoice.find(filter)
                .populate('folder_id', 'name is_active')
                .sort({ 'deletion_meta.deleted_at': -1 })
                .skip(skip)
                .limit(pageSize),
            Invoice.countDocuments(filter),
        ]);

        return res.json({
            archivedInvoices,
            total,
            page: parseInt(page, 10),
            totalPages: Math.ceil(total / pageSize),
        });
    } catch (err) {
        console.error('[Invoice] getArchiveVault error:', err);
        return res.status(500).json({ error: 'Failed to fetch archive vault' });
    }
};

// 9. Restore Soft-Deleted Invoice (Super Admin only)
const restoreInvoice = async (req, res) => {
    try {
        const { invoiceId } = req.params;

        const invoice = await Invoice.findById(invoiceId).populate('folder_id');
        if (!invoice) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        if (!invoice.is_deleted) {
            return res.status(400).json({ error: 'Invoice is already active' });
        }

        const previousReason = invoice.deletion_meta?.delete_reason;
        invoice.is_deleted = false;
        invoice.deletion_meta = {
            deleted_by: null,
            deleted_at: null,
            delete_reason: '',
        };

        await invoice.save();

        logInvoiceActivity({
            action: 'INVOICE_RESTORED',
            user: req.user,
            folderId: invoice.folder_id?._id,
            folderName: invoice.folder_id?.name || '',
            invoiceId: invoice._id,
            invoiceName: invoice.file_name,
            details: { restoredFromReason: previousReason },
            ipAddress: req.ip,
        });

        return res.json({ message: 'Invoice restored successfully to active folder', invoice });
    } catch (err) {
        console.error('[Invoice] restoreInvoice error:', err);
        return res.status(500).json({ error: 'Failed to restore invoice' });
    }
};

// 10. Permanently Purge Invoice from S3 & Database (Super Admin only)
const purgeInvoicePermanently = async (req, res) => {
    try {
        const { invoiceId } = req.params;

        const invoice = await Invoice.findById(invoiceId).populate('folder_id');
        if (!invoice) {
            return res.status(404).json({ error: 'Invoice not found' });
        }

        // Delete from S3
        if (invoice.stored_s3_key) {
            await s3Service.deleteS3Object(invoice.stored_s3_key);
        }

        await Invoice.findByIdAndDelete(invoiceId);

        logInvoiceActivity({
            action: 'INVOICE_PURGED',
            user: req.user,
            folderId: invoice.folder_id?._id,
            folderName: invoice.folder_id?.name || '',
            invoiceId: invoice._id,
            invoiceName: invoice.file_name,
            details: { permanentlyDeletedKey: invoice.stored_s3_key },
            ipAddress: req.ip,
        });

        return res.json({ message: 'Invoice permanently purged from S3 and database' });
    } catch (err) {
        console.error('[Invoice] purgeInvoicePermanently error:', err);
        return res.status(500).json({ error: 'Failed to permanently delete invoice' });
    }
};

module.exports = {
    batchPresignUpload,
    confirmBatchUpload,
    getInvoices,
    getInvoiceViewUrl,
    getInvoiceDownloadUrl,
    getBatchDownloadUrls,
    softDeleteInvoice,
    getArchiveVault,
    restoreInvoice,
    purgeInvoicePermanently,
};
