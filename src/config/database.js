// Importa Sequelize, el ORM que permite interactuar con la base de datos.
const { Sequelize } = require('sequelize');  

// Carga las variables de entorno desde un archivo .env.
require('dotenv').config();  

// Crea una instancia de Sequelize con la configuración de la base de datos.
const sequelize = new Sequelize(
  process.env.DB_NAME,  // Nombre de la base de datos
  process.env.DB_USER,  // Usuario de la base de datos
  process.env.DB_PASS,  // Contraseña del usuario
  {
    host: process.env.DB_HOST,  // Dirección del servidor de la base de datos
    dialect: 'postgres',  // Especifica que se usará PostgreSQL como base de datos
    define: {
      timestamps: true,  // Agrega automáticamente los campos createdAt y updatedAt a los modelos
      underscored: true, // Usa snake_case en lugar de camelCase para los nombres de columnas
    }
  }
);

// Exporta la instancia de Sequelize para ser utilizada en otros archivos.
module.exports = sequelize;
