const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const mongoose = require('mongoose');

const cleanManagedBy = async () => {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to MongoDB.');

    const db = mongoose.connection.db;
    const users = await db.collection('users').find({}).toArray();
    console.log(`Processing ${users.length} users...`);

    let updatedCount = 0;
    for (const user of users) {
      let flatList = [];
      const flatten = (val) => {
        if (Array.isArray(val)) {
          val.forEach(flatten);
        } else if (val) {
          // If it's an ObjectId or a valid string representation of ObjectId
          const strVal = val.toString().trim();
          if (mongoose.Types.ObjectId.isValid(strVal)) {
            flatList.push(new mongoose.Types.ObjectId(strVal));
          }
        }
      };
      flatten(user.managed_by);

      // Unique ObjectIds
      const uniqueIds = [];
      const seen = new Set();
      for (const id of flatList) {
        const idStr = id.toString();
        if (!seen.has(idStr)) {
          seen.add(idStr);
          uniqueIds.push(id);
        }
      }

      await db.collection('users').updateOne(
        { _id: user._id },
        { $set: { managed_by: uniqueIds } }
      );
      console.log(`Cleaned ${user.email}: ${JSON.stringify(user.managed_by)} -> ${JSON.stringify(uniqueIds)}`);
      updatedCount++;
    }

    console.log(`Successfully cleaned ${updatedCount} users.`);
    process.exit(0);
  } catch (err) {
    console.error('Cleanup failed:', err);
    process.exit(1);
  }
};

cleanManagedBy();
