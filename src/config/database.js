// Importa Sequelize, el ORM que permite interactuar con la base de datos.
const { Sequelize } = require('sequelize');  

// Carga las variables de entorno desde un archivo .env.
require('dotenv').config();  

// Importa el logger para mostrar mensajes en la consola.
const logger = require('../logger');
// Crea una instancia de Sequelize con la configuración de la base de datos.
const sequelize = new Sequelize(
  process.env.DB_NAME,  // Nombre de la base de datos
  process.env.DB_USER,  // Usuario de la base de datos
  process.env.DB_PASS,  // Contraseña del usuario
  {
    host: process.env.DB_HOST,  // Dirección del servidor de la base de datos
    dialect: 'postgres',  // Especifica que se usará PostgreSQL como base de datos
    logging: (msg) => logger.info(msg),  // Muestra los mensajes de Sequelize en la consola
    define: {
      timestamps: true,  // Agrega automáticamente los campos createdAt y updatedAt a los modelos
      underscored: true, // Usa snake_case en lugar de camelCase para los nombres de columnas
    }
  }
);

// Función para conectar y sincronizar la base de datos
const connectDB = async () => {
  try {
    await sequelize.authenticate();
    console.log('Connection to the database established successfully.');

    if (process.env.DB_SYNC === 'true') {
      await sequelize.sync({ alter: true }); // Actualiza la base de datos sin perder datos
      console.log('Database synchronized with the models.');
    }
  } catch (error) {
    console.error('Error connecting to database:', error);
    process.exit(1); // Detener la aplicación si no puede conectar a la BD
  }
};

// Exporta la instancia de Sequelize para ser utilizada en otros archivos.
module.exports = sequelize;
