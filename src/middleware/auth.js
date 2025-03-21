const jwt = require('jsonwebtoken');
require('dotenv').config();  // Asegurar que las variables de entorno estén disponibles

function auth(req, res, next) {
  const token = req.header('Authorization'); // Usar "Authorization: Bearer <token>"

  if (!token) {
    return res.status(401).json({ message: 'Acceso denegado. No se proporcionó un token.' });
  }

  try {
    const tokenWithoutBearer = token.replace('Bearer ', ''); // Remover "Bearer " del token
    const secretKey = process.env.JWT_SECRET;

    if (!secretKey) {
      console.error("JWT_SECRET no está definido en .env");
      return res.status(500).json({ message: 'Error en el servidor. Falta la configuración de JWT.' });
    }

    const decoded = jwt.verify(tokenWithoutBearer, secretKey);
    req.user = decoded;  // Agregar la info del usuario al request
    next(); // Pasar al siguiente middleware o controlador
  } catch (error) {
    return res.status(403).json({ message: 'Token inválido o expirado.' });
  }
}

module.exports = auth;
