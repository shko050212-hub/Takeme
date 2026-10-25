const Database = require('better-sqlite3');
const db = new Database('shuttle_db.sqlite');
const rows = db.prepare('SELECT * FROM academies;').all();
console.log(rows);
