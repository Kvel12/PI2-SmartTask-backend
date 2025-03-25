// Importación de Sequelize, la configuración de la base de datos y bcrypt para encriptar contraseñas
const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');
const bcrypt = require('bcryptjs');

// Definición del modelo "User" (Usuario)
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
}, {
  timestamps: true, // Sequelize agregará automáticamente los campos createdAt y updatedAt
  hooks: {
    // Antes de crear un usuario, encripta la contraseña
    beforeCreate: async (user) => {
      if (user.password) {
        const salt = await bcrypt.genSalt(10); // Genera un "sal" para la encriptación
        user.password = await bcrypt.hash(user.password, salt); // Encripta la contraseña
      }
    },
    
    // Antes de actualizar un usuario, encripta la nueva contraseña si ha cambiado
    beforeUpdate: async (user) => {
      if (user.changed('password')) { // Solo encripta si la contraseña ha sido modificada
        const salt = await bcrypt.genSalt(10);
        user.password = await bcrypt.hash(user.password, salt);
      }
    }
  }
});

// Exportación del modelo para su uso en otras partes de la aplicación
module.exports = User;
