const mongoose = require('mongoose');
require('dotenv').config();
const chalk = require('chalk');

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI, {
            maxPoolSize: 20, // better performance under load
        });
        console.log(`Worker ${process.pid} connected to MongoDB`);
    } catch (err) {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    }
}

module.exports = connectDB;