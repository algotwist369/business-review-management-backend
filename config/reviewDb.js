const mongoose = require('mongoose');
require('dotenv').config();

const reviewConnection = mongoose.createConnection();
let connectPromise = null;

const connectReviewDB = async () => {
    if (reviewConnection.readyState === 1) {
        return reviewConnection;
    }

    if (!process.env.MONGO_URL_FOR_REVIEW_DATABASE) {
        console.warn('MONGO_URL_FOR_REVIEW_DATABASE is not configured. AI review storage is unavailable.');
        return reviewConnection;
    }

    if (!connectPromise) {
        connectPromise = reviewConnection.openUri(process.env.MONGO_URL_FOR_REVIEW_DATABASE, {
            maxPoolSize: 10,
        }).then(() => {
            console.log(`Worker ${process.pid} connected to review MongoDB`);
            return reviewConnection;
        }).catch((error) => {
            connectPromise = null;
            throw error;
        });
    }

    return connectPromise;
};

const isReviewDbReady = () => reviewConnection.readyState === 1;

module.exports = {
    connectReviewDB,
    isReviewDbReady,
    reviewConnection,
};
