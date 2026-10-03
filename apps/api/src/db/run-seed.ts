import { loadConfig } from '../config.js';
import { closeDatabase, openDatabase, seedDatabase } from './index.js';

const db = openDatabase({ path: loadConfig().databasePath });
seedDatabase(db);
console.log('Database seeded successfully.');
closeDatabase(db);
