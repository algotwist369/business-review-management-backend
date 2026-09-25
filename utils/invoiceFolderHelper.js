const mongoose = require('mongoose');
const InvoiceFolder = require('../models/invoiceFolderModel');

/**
 * Resolve folder by ObjectId, name, or hierarchical path (e.g. "FOLDER 1/2024" or "FOLDER 1")
 */
const resolveFolderByIdOrPath = async (identifier) => {
    if (!identifier) return null;
    const decoded = decodeURIComponent(identifier).trim();

    // 1. Direct ObjectId check
    if (mongoose.Types.ObjectId.isValid(decoded)) {
        const byId = await InvoiceFolder.findById(decoded);
        if (byId && byId.is_active) return byId;
    }

    // 2. Path-based resolution (e.g. "FOLDER 1/2024" or "FOLDER 1")
    const segments = decoded.split('/').filter(Boolean);
    if (segments.length === 0) return null;

    let currentParentId = null;
    let foundFolder = null;

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        foundFolder = await InvoiceFolder.findOne({
            name: segment,
            parent_id: currentParentId,
            is_active: true,
        });

        if (!foundFolder) {
            // Fallback: search by name
            foundFolder = await InvoiceFolder.findOne({
                name: segment,
                is_active: true,
            });
            if (!foundFolder) return null;
        }

        currentParentId = foundFolder._id;
    }

    return foundFolder;
};

module.exports = {
    resolveFolderByIdOrPath,
};
