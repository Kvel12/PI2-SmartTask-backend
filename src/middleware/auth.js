// Importamos jsonwebtoken para manejar la verificación de tokens JWT
const jwt = require('jsonwebtoken');

// Middleware de autenticación
function auth(req, res, next) {
  // Obtenemos el token del encabezado de la solicitud
  const token = req.header('x-auth-token');
  
  // Si no hay token, se deniega el acceso
  if (!token) return res.status(401).json({ message: 'No token, authorization denied' });

  try {
    // Verificamos y decodificamos el token con la clave secreta almacenada en las variables de entorno
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Agregamos la información del usuario al objeto de la solicitud para su uso en rutas protegidas
    req.user = decoded;
    
    // Pasamos al siguiente middleware o controlador
    next();
  } catch (ex) {
    // Si el token no es válido, respondemos con un error 400
    res.status(400).json({ message: 'Token is not valid' });
  }
}

// Exportamos el middleware para su uso en las rutas protegidas
module.exports = auth;

//////////////////////////////////////////////////////////////////////////

// const jwt = require('jsonwebtoken');
// require('dotenv').config();  // Asegurar que las variables de entorno estén disponibles

// function auth(req, res, next) {
//   const token = req.header('Authorization'); // Usar "Authorization: Bearer <token>"

//   if (!token) {
//     return res.status(401).json({ message: 'Acceso denegado. No se proporcionó un token.' });
//   }

//   try {
//     const tokenWithoutBearer = token.replace('Bearer ', ''); // Remover "Bearer " del token
//     const secretKey = process.env.JWT_SECRET;

//     if (!secretKey) {
//       console.error("JWT_SECRET no está definido en .env");
//       return res.status(500).json({ message: 'Error en el servidor. Falta la configuración de JWT.' });
//     }

//     const decoded = jwt.verify(tokenWithoutBearer, secretKey);
//     req.user = decoded;  // Agregar la info del usuario al request
//     next(); // Pasar al siguiente middleware o controlador
//   } catch (error) {
//     return res.status(403).json({ message: 'Token inválido o expirado.' });
//   }
// }

// module.exports = auth;

//////////////////////////////////////////////////////////////////////////

// // const jwt = require("jsonwebtoken");
// // require("dotenv").config(); // Asegurar acceso a variables de entorno

// // function auth(req, res, next) {
// //   const authHeader = req.header("Authorization");

// //   if (!authHeader || !authHeader.startsWith("Bearer ")) {
// //     return res.status(401).json({ message: "No token, authorization denied" });
// //   }

// //   const token = authHeader.replace("Bearer ", ""); // Extraer solo el token

// //   try {
// //     const secretKey = process.env.JWT_SECRET;
// //     if (!secretKey) {
// //       console.error("ERROR: JWT_SECRET is not defined in .env file");
// //       return res.status(500).json({ message: "Server error: JWT misconfiguration" });
// //     }

// //     const decoded = jwt.verify(token, secretKey);
// //     req.user = decoded;
// //     next();
// //   } catch (error) {
// //     console.error("JWT verification failed:", error.message);
// //     return res.status(403).json({ message: "Invalid or expired token" });
// //   }
// // }

// // module.exports = auth;
