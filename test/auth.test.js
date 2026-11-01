import 'dotenv/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import {safeReturnPath} from '../frontend/src/authNavigation.js';

test('login return accepts only known local destinations',()=>{
  assert.equal(safeReturnPath('/articles/2?commentId=4#comment-4'),'/articles/2?commentId=4#comment-4');
  for(const v of ['https://example.com','//example.com','/\\example.com','/login','/register','/admin',undefined])assert.equal(safeReturnPath(v),'/');
});

test('user login rotates session, validates credentials and logout revokes access',async()=>{
  const db=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
  const name='auth'+Date.now().toString(36);let id,cookie='',csrf='';
  async function request(path,method='GET',body,sessionCookie=cookie){const r=await fetch('http://localhost:3000/api'+path,{method,headers:{cookie:sessionCookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:body?JSON.stringify(body):undefined});const set=r.headers.get('set-cookie');if(set)cookie=set.split(';')[0];return {status:r.status,body:await r.json()}}
  try{
    const [r]=await db.execute('INSERT INTO users(username,password_hash,nickname) VALUES (?,?,?)',[name,await bcrypt.hash('password123',10),'登录测试']);id=r.insertId;
    assert.equal((await request('/auth/login','POST',{username:name,password:'password123'})).status,403);
    csrf=(await request('/auth/csrf')).body.data.token;const oldCookie=cookie;
    assert.equal((await request('/auth/login','POST',{username:name,password:'wrongpass'})).status,401);
    const logged=await request('/auth/login','POST',{username:name,password:'password123'});assert.equal(logged.status,200);assert.equal(logged.body.data.user.role,'USER');assert.notEqual(cookie,oldCookie);csrf=logged.body.data.csrfToken;
    assert.equal((await request('/auth/me')).body.data.id,String(id));assert.equal((await request('/auth/me','GET',undefined,oldCookie)).body.data,null);
    const activeCookie=cookie;assert.equal((await request('/auth/logout','POST')).status,200);assert.equal((await request('/me/favorites','GET',undefined,activeCookie)).status,401);
    csrf=(await request('/auth/csrf')).body.data.token;
    await db.execute('UPDATE users SET role="ADMIN" WHERE id=?',[id]);assert.equal((await request('/auth/login','POST',{username:name,password:'password123'})).status,401);
    await db.execute('UPDATE users SET role="USER",status="DISABLED" WHERE id=?',[id]);assert.equal((await request('/auth/login','POST',{username:name,password:'password123'})).status,401);
    assert.equal((await request('/dev/login','POST',{username:name,password:'password123'})).status,404);
  }finally{if(id)await db.execute('DELETE FROM users WHERE id=?',[id]);await db.end()}
});
