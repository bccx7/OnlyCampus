import 'dotenv/config';
import mysql from 'mysql2/promise';
import {readFile} from 'node:fs/promises';

export async function migrate(db) {
  const add = async (table, column, definition) => {
    const [rows] = await db.execute('SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,column]);
    if (!rows.length) await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  await add('comments','reply_to_id','BIGINT NULL');
  await add('users','created_at','DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await add('users','session_version','INT NOT NULL DEFAULT 0');
  await add('users','avatar_path','VARCHAR(500) NULL');
  await add('series','cover_path','VARCHAR(500) NULL');
  await add('articles','created_at','DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP');
  await add('articles','submitted_at','DATETIME NULL');
  await db.query('ALTER TABLE articles MODIFY body_markdown MEDIUMTEXT NOT NULL');
  await add('articles','version','INT NOT NULL DEFAULT 1');
  await add('categories','sort_order','INT NOT NULL DEFAULT 0');
  await add('tags','sort_order','INT NOT NULL DEFAULT 0');
  await db.query('ALTER TABLE notifications MODIFY article_id BIGINT NULL, MODIFY comment_id BIGINT NULL');
  await db.query(await readFile(new URL('./operations.sql',import.meta.url),'utf8'));
  // Preserve historical first publication counts when upgrading the reading module.
  await db.query(`INSERT IGNORE INTO publication_events(article_id,first_published_at)
    SELECT id,first_published_at FROM articles WHERE first_published_at IS NOT NULL`);
}

if (process.argv[1] && new URL(import.meta.url).pathname.endsWith('/migrate.js') && /[\\/]migrate\.js$/.test(process.argv[1])) {
  const db = await mysql.createConnection({host:process.env.DB_HOST||'127.0.0.1',port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER||'root',password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME||'onlycampus',multipleStatements:true});
  try { await migrate(db); console.log('Operations schema upgraded.'); } finally { await db.end(); }
}
