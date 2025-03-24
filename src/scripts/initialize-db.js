const path = require('path');
const initDB = require('./initDB');

async function runInitDB() {
  try {
    await initDB();
    console.log('Database initialized successfully');
    process.exit(0);
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }
}

runInitDB();