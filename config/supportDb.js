const mongoose = require('mongoose');
require('dotenv').config();

const supportConnection = mongoose.createConnection();
let connectPromise = null;

const getSupportMongoUri = () =>
    process.env.MONGO_URL_FOR_SUPPORT_DATABASE ||
    process.env.MONGO_URI_FOR_SUPPORT_DATABASE ||
    process.env.SUPPORT_MONGO_URI ||
    process.env.MONGO_URI;

const connectSupportDB = async () => {
    if (supportConnection.readyState === 1) {
        return supportConnection;
    }

    const uri = getSupportMongoUri();
    if (!uri) {
        console.warn('Support MongoDB URI is not configured. Support ticket storage is unavailable.');
        return supportConnection;
    }

    if (!connectPromise) {
        connectPromise = supportConnection.openUri(uri, {
            maxPoolSize: 10,
        }).then(() => {
            console.log(`Worker ${process.pid} connected to support MongoDB`);
            return supportConnection;
        }).catch((error) => {
            connectPromise = null;
            throw error;
        });
    }

    return connectPromise;
};

const isSupportDbReady = () => supportConnection.readyState === 1;

module.exports = {
    connectSupportDB,
    isSupportDbReady,
    supportConnection,
};
