const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

const inspectUsers = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB.');

    const db = mongoose.connection.db;
    const users = await db.collection('users').find({}).toArray();
    console.log(`Total users found: ${users.length}`);

    users.forEach(user => {
      console.log(`Email: ${user.email}, Role: ${user.role}, managed_by: ${JSON.stringify(user.managed_by)}, type of managed_by: ${typeof user.managed_by}, isArray: ${Array.isArray(user.managed_by)}`);
    });

    process.exit(0);
  } catch (err) {
    console.error(err);
    process.exit(1);
  }
};

inspectUsers();
