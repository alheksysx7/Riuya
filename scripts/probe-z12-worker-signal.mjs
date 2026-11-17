// Solo para detener ordenadamente el proceso hijo del laboratorio en Windows.
process.on('message',value=>{
 if(value==='stop'){process.emit('SIGTERM');process.disconnect();}
});
