import db from "../../connection.js";

const response = db.query(
  `CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT, first_name TEXT, last_name TEXT);`
);

console.log(response);

db.end();
