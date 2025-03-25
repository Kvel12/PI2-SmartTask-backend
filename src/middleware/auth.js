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