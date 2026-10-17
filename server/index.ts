import {seed}from'./seed.js';import{app,finishApp}from'./app.js';import{syncGitHub}from'./connectors/github.js';import{principal}from'./store/db.js';
seed();await syncGitHub(principal('ava')!,'northwind');await finishApp();const port=Number(process.env.PORT||4173);app.listen(port,process.env.HOST||'127.0.0.1',()=>console.log(`Relay ready at http://${process.env.HOST||'127.0.0.1'}:${port}`));
