import {existsSync,unlinkSync} from 'node:fs';
if(process.argv.includes('--reset')){const file=process.env.DATABASE_PATH||'.data/relay.sqlite';for(const suffix of ['','-wal','-shm'])if(existsSync(file+suffix))unlinkSync(file+suffix)}
const {seed}=await import('../server/seed.js');seed();console.log('Relay demo seeded (idempotent).');
