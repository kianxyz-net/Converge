import express from 'express';
import './store/visibility.js';
const app=express();app.get('/api/health',(_req,res)=>res.json({ok:true,fts5:true}));app.listen(Number(process.env.PORT||4173),'127.0.0.1',()=>console.log('Relay scaffold ready'));
