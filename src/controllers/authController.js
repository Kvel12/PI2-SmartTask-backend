const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/user');
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

    // Validar datos obligatorios
    if (!username || !password || !name) {
      return res.status(400).json({ message: 'All fields are required.' });
    }

    // Verificar si el usuario ya existe
    const existingUser = await User.findOne({ where: { username } });
    if (existingUser) {
      return res.status(409).json({ message: 'The username is already in use.' });
    }

    // Hashear la contraseña antes de guardarla
    const hashedPassword = await bcrypt.hash(password, BCRYPT_SALT_ROUNDS);
    const user = await User.create({ username, password: hashedPassword, name });

    // Generar token con más información
    const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

    res.status(201).json({ message: 'User registered successfully.', token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error registering user.' });
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

    // Validar datos obligatorios
    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required.' });
    }

    // Buscar usuario en la base de datos
    const user = await User.findOne({ where: { username } });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    // Verificar si la contraseña ingresada coincide con la almacenada
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials.' });
    }

    // Generar token con más información
    const token = jwt.sign(
      { userId: user.id, username: user.username },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.status(200).json({ message: 'Login successful.', token });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Error logging in.' });
  }
}

module.exports = { register, login };
