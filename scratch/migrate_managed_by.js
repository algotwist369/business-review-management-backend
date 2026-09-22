const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');
const User = require('../model/user');

const runMigration = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB.');

    const db = mongoose.connection.db;
    // Find all users where managed_by is not an array
    const usersToMigrate = await db.collection('users').find({
      managed_by: { $not: { $type: 'array' } }
    }).toArray();

    console.log(`Found ${usersToMigrate.length} users requiring managed_by array migration.`);

    let migratedCount = 0;
    for (const user of usersToMigrate) {
      let newManagedBy = [];
      if (user.managed_by !== null && user.managed_by !== undefined) {
        newManagedBy = [user.managed_by];
      }
      await db.collection('users').updateOne(
        { _id: user._id },
        { $set: { managed_by: newManagedBy } }
      );
      console.log(`Migrated user ${user.email} (old: ${JSON.stringify(user.managed_by)}, new: ${JSON.stringify(newManagedBy)})`);
      migratedCount++;
    }
    console.log(`Migration complete. Successfully updated ${migratedCount} users.`);
    process.exit(0);
  } catch (err) {
    console.error('Migration execution failed:', err);
    process.exit(1);
  }
};

runMigration();
