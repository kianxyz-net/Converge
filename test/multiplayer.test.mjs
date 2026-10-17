import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';

test('two departments share a room, revise a proposal, and approve the same revision',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'accord-test-'));
 const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',ACCORD_DATA_DIR:dir},stdio:['ignore','pipe','pipe']});
 try{
  let output='';const base=await new Promise((resolve,reject)=>{child.stdout.on('data',c=>{output+=c;const match=output.match(/http:\/\/127\.0\.0\.1:\d+/);if(match)resolve(match[0])});child.on('error',reject);child.on('exit',code=>reject(Error('Server exited: '+code)))});
  const get=()=>fetch(base+'/api/state').then(r=>r.json());
  const post=async(action,body,token)=>{const res=await fetch(base+'/api/'+action,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify(body)});return {status:res.status,...await res.json()}};
  const business=await post('session',{name:'Jamie',department:'Business'}),engineering=await post('session',{name:'Alex',department:'Engineering'});
  const roomId=(await get()).rooms[0].id;
  assert.equal((await post('approve',{roomId,revision:0},business.token)).status,403);
  for(const u of [business,engineering])assert.equal((await post('join',{roomId},u.token)).status,200);
  const controller=new AbortController();const stream=await fetch(base+'/api/events',{signal:controller.signal});const reader=stream.body.getReader();
  let event=await reader.read();assert.match(new TextDecoder().decode(event.value),/Jamie/);
  await post('message',{roomId,text:'Customer can accept a smaller pilot.'},business.token);
  event=await reader.read();assert.match(new TextDecoder().decode(event.value),/Customer can accept/);controller.abort();
  await post('helper',{roomId},business.token);
  let room=(await get()).rooms[0];assert.equal(room.participants.length,2);assert.equal(room.revision,1);assert.deepEqual(room.messages.find(m=>m.type==='helper').refs,['crm','discovery']);
  await post('approve',{roomId,revision:1},business.token);
  assert.equal((await get()).rooms[0].status,'Needs approval');
  await post('redirect',{roomId,text:'We cannot postpone the dashboard refresh.'},engineering.token);
  room=(await get()).rooms[0];assert.equal(room.revision,2);assert.deepEqual(room.approvals,{});assert.equal(room.proposal.target,'Date pending capacity review');assert.match(room.proposal.constraints[0],/Alex/);
  assert.equal((await post('approve',{roomId,revision:1},business.token)).status,409);
  for(const u of [business,engineering])await post('approve',{roomId,revision:2},u.token);
  room=(await get()).rooms[0];assert.equal(room.status,'Approved');assert.equal(room.approvals.Business.name,'Jamie');assert.equal(room.approvals.Engineering.name,'Alex');
  const snapshot=await get();assert.ok(snapshot.sources.every(s=>!('privateNote'in s)));
  assert.equal((await post('message',{roomId,text:'Unauthorized'},'invalid')).status,401);
  assert.equal((await post('rooms',{title:'New negotiation',description:'A different scope.'},business.token)).status,201);
  assert.equal((await get()).rooms.length,2);
 }finally{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill();await exited}await rm(dir,{recursive:true,force:true})}
});
