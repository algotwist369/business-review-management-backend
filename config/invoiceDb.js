const mongoose = require('mongoose');
require('dotenv').config();

const invoiceConnection = mongoose.createConnection();
let connectPromise = null;

const getInvoiceMongoUri = () =>
    process.env.OMEGA_INVOICE_URL ||
    process.env.INVOICE_DB_URL ||
    process.env.MONGO_URI;

const connectInvoiceDB = async () => {
    if (invoiceConnection.readyState === 1) {
        return invoiceConnection;
    }

    const uri = getInvoiceMongoUri();
    if (!uri) {
        console.warn('[InvoiceDB] OMEGA_INVOICE_URL is not configured.');
        return invoiceConnection;
    }

    const options = {
        maxPoolSize: 25,
    };

    try {
        const cleanUri = uri.split('?')[0].replace(/\/+$/, '');
        const parts = cleanUri.split('/');
        if (parts.length <= 3 || !parts[3]) {
            options.dbName = 'invoice_database';
        }
    } catch (e) {
        options.dbName = 'invoice_database';
    }

    if (!connectPromise) {
        connectPromise = invoiceConnection.openUri(uri, options).then(() => {
            console.log(`Worker ${process.pid} connected to isolated Invoice MongoDB [${invoiceConnection.name || 'invoice_database'}]`);
            return invoiceConnection;
        }).catch((error) => {
            connectPromise = null;
            console.error('[InvoiceDB] Connection error:', error.message);
            throw error;
        });
    }

    return connectPromise;
};

const isInvoiceDbReady = () => invoiceConnection.readyState === 1;

module.exports = {
    connectInvoiceDB,
    isInvoiceDbReady,
    invoiceConnection,
};
