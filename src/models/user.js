const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Definición del modelo "User"
/**
 * Represents a User in the system.
 * 
 * @typedef {Object} User
 * @property {string} username - Unique username of the user. This field is required.
 * @property {string} password - Encrypted password of the user. This field is required.
 * @property {string} name - Real name of the user. This field is required.
 * @property {Date} createdAt - The date and time when the user was created. Defaults to the current date and time.
 * @property {Date} updatedAt - The date and time when the user was last updated. Defaults to the current date and time.
 */

const User = sequelize.define('User', {
  username: {
    type: DataTypes.STRING,  // Nombre de usuario único
    unique: true,
    allowNull: false
  },
  password: {
    type: DataTypes.STRING,  // Contraseña del usuario (debe estar encriptada en una implementación real)
    allowNull: false
  },
  name: {
    type: DataTypes.STRING,  // Nombre real del usuario
    allowNull: false
  },
  createdAt: {
    type: DataTypes.DATE,  // Fecha de creación
    defaultValue: DataTypes.NOW
  },
  updatedAt: {
    type: DataTypes.DATE,  // Fecha de última actualización
    defaultValue: DataTypes.NOW
  }
});

module.exports = User;  // Exporta el modelo
