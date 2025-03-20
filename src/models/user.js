const { DataTypes } = require('sequelize');
const sequelize = require('../config/database');

// Definición del modelo "User"
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
