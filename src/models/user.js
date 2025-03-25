// Importación de Sequelize, la configuración de la base de datos y bcrypt para encriptar contraseñas
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
  // Nombre de usuario único
  username: {
    type: DataTypes.STRING,
    unique: true, // No puede haber usuarios con el mismo nombre de usuario
    allowNull: false // Es obligatorio
  },
  
  // Contraseña del usuario (se almacenará encriptada)
  password: {
    type: DataTypes.STRING,
    allowNull: false // Es obligatoria
  },
  
  // Nombre real del usuario
  name: {
    type: DataTypes.STRING,
    allowNull: false // Es obligatorio
  },
  
  // Fecha de creación del usuario
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW // Se asigna automáticamente la fecha y hora actual
  },
  
  // Fecha de última actualización del usuario
  updatedAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW // Se actualiza automáticamente cuando se modifica el usuario
  }
});

// Exportación del modelo para su uso en otras partes de la aplicación
module.exports = User;
