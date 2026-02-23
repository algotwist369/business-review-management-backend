require('dotenv').config();
const cluster = require('cluster');
const os = require('os');
const process = require('process');

const numCPUs = os.cpus().length;

if (cluster.isPrimary) {
    console.log(`Primary process ${process.pid} is running`);
    console.log(`Forking ${numCPUs} workers...\n`);

    // Fork workers
    for (let i = 0; i < numCPUs; i++) {
        cluster.fork();
    }

    // Restart worker if crashes
    cluster.on('exit', (worker, code, signal) => {
        console.log(`Worker ${worker.process.pid} died. Restarting...`);
        cluster.fork();
    });

} else {
    // Worker Process
    const express = require('express');
    const connectDB = require('./config/db');
    const cors = require('cors');
    const helmet = require('helmet');
    const compression = require('compression');
    const morgan = require('morgan')

    const app = express();

    // ==========================
    // 🔒 Security Middlewares
    // ==========================
    app.use(helmet());
    app.use(compression());
    app.use(morgan('dev'))
    app.use(cors({
        origin: process.env.CORS_ORIGIN || `https://business-review-management-frontend.vercel.app` || 'http://localhost:5173',
        credentials: true,
    }));

    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true }));


    // ==========================
    // 🗄 MongoDB Connection
    // ==========================
    connectDB();

    // ==========================
    // 📦 Routes
    // ==========================
    app.use('/api/users', require('./routes/userRoute'));
    app.use('/api/super-admin', require('./routes/superAdminRoute'));
    app.use('/api/business', require('./routes/businessRoute'));
    app.use('/api/reviews', require('./routes/reviewRoute'));


    // ==========================
    // ❤️ Health Check
    // ==========================
    app.get('/health', (req, res) => {
        res.status(200).json({
            status: 'OK',
            pid: process.pid,
        });
    });


    // ==========================
    // ❌ Global Error Handler
    // ==========================
    app.use((err, req, res, next) => {
        console.error(err.stack);
        res.status(500).json({ error: 'Internal Server Error' });
    });


    // ==========================
    // 🚀 Start Server
    // ==========================
    const PORT = process.env.PORT || 7001;

    const server = app.listen(PORT, () => {
        console.log(`Worker ${process.pid} running on port ${PORT}`);
    });


    // ==========================
    // 🛑 Graceful Shutdown
    // ==========================
    const shutdown = async () => {
        console.log(`Worker ${process.pid} shutting down...`);
        server.close(async () => {
            await mongoose.connection.close();
            process.exit(0);
        });
    };

    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
}
