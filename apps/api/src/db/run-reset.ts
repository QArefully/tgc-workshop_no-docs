import { loadConfig } from '../config.js';
import { closeDatabase, openDatabase, resetDatabase, seedDatabase } from './index.js';

const db = openDatabase({ path: loadConfig().databasePath });
resetDatabase(db);
seedDatabase(db);
console.log('Database reset and re-seeded.');
closeDatabase(db);
