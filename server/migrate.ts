import { config } from './config.js';
import { Store } from './db.js';
const s = new Store(config().dbPath);
s.close();
console.log('Database migrations applied.');
