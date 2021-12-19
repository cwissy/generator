import { query } from "../db/connection.js";

export async function getAllUsers() {
  const result = query(`SELECT * FROM users;`);
  return result.rows;
}
