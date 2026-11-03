import 'dotenv/config';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

const username=process.env.ADMIN_USERNAME, password=process.env.ADMIN_PASSWORD;
if(!username||!/^[A-Za-z0-9_]{4,24}$/.test(username)||!password||password.length<12||password.length>64||Buffer.byteLength(password)>72) {
  throw Error('Set ADMIN_USERNAME (4–24 letters/digits/underscores) and ADMIN_PASSWORD (12–64 characters, max 72 UTF-8 bytes). Existing accounts are never overwritten.');
}
const db=await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'onlycampus'});
try {
  await db.execute("INSERT INTO users(username,password_hash,nickname,role) VALUES (?,?,?,'ADMIN')",[username,await bcrypt.hash(password,12),'运营管理员']);
  console.log('Administrator created.');
} finally {await db.end();}
