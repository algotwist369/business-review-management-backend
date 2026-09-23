const mongoose = require('mongoose');
require('dotenv').config();

const taskConnection = mongoose.createConnection();
let connectPromise = null;

const getTaskMongoUri = () =>
    process.env.TAKS_DB_URL ||
    process.env.TASK_DB_URL ||
    process.env.MONGO_URL_FOR_TASK_DATABASE ||
    process.env.MONGO_URI;

const connectTaskDB = async () => {
    if (taskConnection.readyState === 1) {
        return taskConnection;
    }

    const uri = getTaskMongoUri();
    if (!uri) {
        console.warn('Task MongoDB URI is not configured.');
        return taskConnection;
    }

    const options = {
        maxPoolSize: 20,
    };

    try {
        const cleanUri = uri.split('?')[0].replace(/\/+$/, '');
        const parts = cleanUri.split('/');
        if (parts.length <= 3 || !parts[3]) {
            options.dbName = 'task_database';
        }
    } catch (e) {
        options.dbName = 'task_database';
    }

    if (!connectPromise) {
        connectPromise = taskConnection.openUri(uri, options).then(() => {
            console.log(`Worker ${process.pid} connected to task MongoDB [${taskConnection.name || 'task_database'}]`);
            return taskConnection;
        }).catch((error) => {
            connectPromise = null;
            throw error;
        });
    }

    return connectPromise;
};

const isTaskDbReady = () => taskConnection.readyState === 1;

module.exports = {
    connectTaskDB,
    isTaskDbReady,
    taskConnection,
};
