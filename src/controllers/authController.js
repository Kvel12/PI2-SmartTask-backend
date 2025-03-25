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

async function login(req, res) {
  try {
    const { username, password } = req.body;

    // Debugging: Log the received credentials
    console.log('Login attempt:', { username, password });

    const user = await User.findOne({ where: { username } });
    if (!user) {
      return res.status(401).json({ 
        error: 'AUTH_ERROR',
        message: 'User not found.'
      });
    }

    // Debugging: Log the stored hashed password
    console.log('Stored hashed password:', user.password);

    try {
      // Verbose logging of password comparison
      const isMatch = await bcrypt.compare(password, user.password);
      console.log('Password comparison result:', isMatch);

      if (!isMatch) {
        return res.status(401).json({ 
          error: 'AUTH_ERROR',
          message: 'Invalid credentials.',
          details: { 
            storedPasswordLength: user.password.length,
            inputPasswordLength: password.length
          }
        });
      }

      // Rest of the login logic remains the same
      const token = jwt.sign(
        { 
          userId: user.id, 
          username: user.username
        },
        process.env.JWT_SECRET,
        { 
          expiresIn: JWT_EXPIRES_IN
        }
      );

      res.status(200).json({ 
        message: 'Login successful.',
        token
      });

    } catch (compareError) {
      console.error('Bcrypt comparison error:', compareError);
      return res.status(500).json({
        error: 'BCRYPT_ERROR',
        message: 'Error during password comparison.',
        details: compareError.message
      });
    }
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      error: 'SERVER_ERROR',
      message: 'Error logging in.',
      details: error.message
    });
  }
}


function logout(req, res) {
  try {
    res.status(200).json({ message: "Logout successful." });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Error during logout." });
  }
}

module.exports = { register, login, logout };
