const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user');
const logger = require('../logger');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '1h'; // Valor por defecto de 1 hora
const BCRYPT_SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10;

// ⚠ Verificar que JWT_SECRET esté configurado
if (!JWT_SECRET) {
  console.error("ERROR: JWT_SECRET is not defined in the .env file");
  process.exit(1);
}

/**
 * Registra un nuevo usuario en el sistema.
 *
 * @async
 * @function register
 * @param {Object} req - Objeto de solicitud HTTP.
 * @param {Object} req.body - Cuerpo de la solicitud que contiene los datos del usuario.
 * @param {string} req.body.username - Nombre de usuario del nuevo usuario.
 * @param {string} req.body.password - Contraseña del nuevo usuario.
 * @param {string} req.body.name - Nombre completo del nuevo usuario.
 * @param {Object} res - Objeto de respuesta HTTP.
 * @returns {void} Devuelve una respuesta HTTP con un token de autenticación o un mensaje de error.
 * @throws {Error} Devuelve un error 500 si ocurre un problema durante el registro.
 */
async function register(req, res) {
  try {
    const { username, password, name } = req.body;
    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await User.create({ username, password: hashedPassword, name });
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });
    logger.info(`User registered: ${user.id}`);
    res.status(201).json({ token });
  } catch (error) {
    logger.error('Error registering user', error);
    res.status(500).json({ message: 'Error registering user' });
  }
}

/**
 * Maneja el inicio de sesión de un usuario.
 *
 * @async
 * @function login
 * @param {Object} req - Objeto de solicitud HTTP.
 * @param {Object} req.body - Cuerpo de la solicitud que contiene las credenciales del usuario.
 * @param {string} req.body.username - Nombre de usuario proporcionado por el cliente.
 * @param {string} req.body.password - Contraseña proporcionada por el cliente.
 * @param {Object} res - Objeto de respuesta HTTP.
 * @returns {void} Envía una respuesta HTTP con un token de autenticación si las credenciales son válidas,
 * o un mensaje de error si las credenciales son inválidas o si ocurre un error en el servidor.
 * @throws {Error} Devuelve un estado 500 si ocurre un error inesperado durante el proceso de inicio de sesión.
 */
async function login(req, res) {
  try {
    const { username, password } = req.body;
    const user = await User.findOne({ where: { username } });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });
    logger.info(`User logged in: ${user.id}`);
    res.status(200).json({ token });
  } catch (error) {
    logger.error('Error logging in', error);
    res.status(500).json({ message: 'Error logging in' });
  }
}

/**
 * Maneja el cierre de sesión de un usuario.
 *
 * @function logout
 * @param {Object} req - Objeto de solicitud HTTP.
 * @param {Object} res - Objeto de respuesta HTTP.
 * @returns {void} Envía una respuesta HTTP confirmando el cierre de sesión.
 */
function logout(req, res) {
  try {
    res.status(200).json({ message: "Logout successful." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error during logout." });
  }
}

module.exports = { register, login, logout };
