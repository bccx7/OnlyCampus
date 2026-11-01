import 'dotenv/config';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';

test('registration validates fields, enforces USER role, hashes password and logs in',async()=>{
  const db=await mysql.createConnection({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
  const username='reg'+Date.now().toString(36);let cookie='',csrf='';
  const body={username,nickname:'注册测试',password:'password123',passwordConfirmation:'password123',role:'ADMIN',status:'DISABLED'};
  async function call(path,method='GET',data){const r=await fetch('http://localhost:3000/api'+path,{method,headers:{cookie,'Content-Type':'application/json','X-CSRF-Token':csrf},body:data?JSON.stringify(data):undefined});const c=r.headers.get('set-cookie');if(c)cookie=c.split(';')[0];return {status:r.status,body:await r.json()}}
  try{
    assert.equal((await call('/auth/register','POST',body)).status,403);
    csrf=(await call('/auth/csrf')).body.data.token;const oldCookie=cookie;
    for(const invalid of [{username:'a'},{nickname:' '},{password:'short'},{passwordConfirmation:'different'}])assert.equal((await call('/auth/register','POST',{...body,...invalid})).status,422);
    const result=await call('/auth/register','POST',body);assert.equal(result.status,200);assert.equal(result.body.data.user.role,'USER');assert.notEqual(cookie,oldCookie);csrf=result.body.data.csrfToken;
    const [[user]]=await db.execute('SELECT * FROM users WHERE username=?',[username]);assert.equal(user.role,'USER');assert.equal(user.status,'ACTIVE');assert.notEqual(user.password_hash,body.password);assert.ok(await bcrypt.compare(body.password,user.password_hash));
    assert.equal((await call('/auth/me')).body.data.id,String(user.id));
    assert.equal((await call('/auth/register','POST',body)).status,409);
    assert.equal((await call('/auth/logout','POST')).status,200);
    csrf=(await call('/auth/csrf')).body.data.token;
    assert.equal((await call('/auth/login','POST',{username,password:body.password})).status,200);
  }finally{await db.execute('DELETE FROM users WHERE username=?',[username]);await db.end()}
});
