// Deshabilitado: el generador anterior atribuía aprobación humana a noticias ficticias.
// No volver a sembrar hasta definir y revisar un mecanismo que distinga fixtures editoriales.
console.error('Generador deshabilitado: requiere un mecanismo de fixtures sin aprobación editorial ficticia.');
process.exitCode = 1;
