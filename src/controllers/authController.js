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
 * Handles user registration by validating input, checking for existing users,
 * hashing the password, creating a new user, and generating a JWT token.
 *
 * @async
 * @function register
 * @param {Object} req - The request object.
 * @param {Object} req.body - The body of the request containing user data.
 * @param {string} req.body.username - The username of the user.
 * @param {string} req.body.password - The password of the user.
 * @param {string} req.body.name - The name of the user.
 * @param {Object} res - The response object.
 * @returns {Promise<void>} Sends a JSON response with a success message and token
 * if registration is successful, or an error message if it fails.
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

    // Loggear el registro del usuario
    logger.info(`User registered: ${user.id}`);
    res.status(201).json({ message: 'User registered successfully.', token });
  } catch (error) {
    logger.error('Error registering user', error);
    console.error(error);
    res.status(500).json({ message: 'Error registering user.' });
  }
}

/**
 * Handles user login by validating credentials and generating a JWT token.
 *
 * @async
 * @function login
 * @param {Object} req - The HTTP request object.
 * @param {Object} req.body - The body of the request containing login credentials.
 * @param {string} req.body.username - The username provided by the user.
 * @param {string} req.body.password - The password provided by the user.
 * @param {Object} res - The HTTP response object.
 * @returns {void} Sends a JSON response with the login result.
 *
 * @throws {Error} If an unexpected error occurs during the login process.
 *
 * @description
 * This function performs the following steps:
 * 1. Extracts the username and password from the request body.
 * 2. Searches for the user in the database using the provided username.
 * 3. Validates the provided password against the stored password hash.
 * 4. If the credentials are valid, generates a JWT token and sends it in the response.
 * 5. Handles and logs errors at various stages, returning appropriate HTTP status codes and error messages.
 */
async function login(req, res) {
  try {
    const { username, password } = req.body;

    // Log more detailed debugging information
    console.error(`Login attempt for username: ${username}`);
    console.error(`Input password length: ${password.length}`);

    // Buscar usuario en la base de datos
    const user = await User.findOne({ where: { username } });
    if (!user) {
      console.error(`User not found: ${username}`);
      return res.status(401).json({ 
        error: 'AUTH_ERROR',
        message: 'User not found.',
        details: { username }
      });
    }

    // Log additional user details for debugging
    console.error(`User found: ${user.username}`);
    console.error(`Stored password hash length: ${user.password.length}`);

    // Comparación de contraseña con más detalles
    let isMatch = false;
    try {
      // Agregar más información de depuración
      console.error('Attempting password comparison');
      
      isMatch = await bcrypt.compare(password, user.password);
      
      console.error(`Password comparison result: ${isMatch}`);
    } catch (compareError) {
      console.error('Error during password comparison:', compareError);
      return res.status(500).json({
        error: 'BCRYPT_ERROR',
        message: 'Error during password comparison.',
        details: {
          errorMessage: compareError.message,
          errorStack: compareError.stack
        }
      });
    }
    
    // Verificación de contraseña
    if (!isMatch) {
      console.error('Password does not match');
      return res.status(401).json({ 
        error: 'AUTH_ERROR',
        message: 'Invalid credentials.',
        details: { 
          usernameFound: !!user,
          passwordMatch: isMatch,
          storedPasswordLength: user.password.length,
          inputPasswordLength: password.length
        }
      });
    }

    // Generar token
    const token = jwt.sign(
      { 
        userId: user.id, 
        username: user.username
      },
      process.env.JWT_SECRET,
      { 
        expiresIn: JWT_EXPIRES_IN,
        algorithm: 'HS256'
      }
    );

    // Respuesta exitosa
    res.status(200).json({ 
      message: 'Login successful.',
      token
    });

  } catch (error) {
    console.error('Unexpected login error:', error);
    res.status(500).json({ 
      error: 'SERVER_ERROR',
      message: 'Error logging in.',
      details: error.message
    });
  }
}


/**
 * Handles the user logout process.
 * Sends a success response if the logout is completed successfully,
 * or an error response if an issue occurs during the process.
 *
 * @param {Object} req - The HTTP request object.
 * @param {Object} res - The HTTP response object.
 * @returns {void}
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
