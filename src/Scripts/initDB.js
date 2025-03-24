const path = require('path');
const { sequelize, User, Project, Task } = require(path.join(__dirname, '..', 'models'));
const bcrypt = require('bcryptjs');

async function initDB() {
   try {
     // Modificación para asegurar que se ejecute en producción
     await sequelize.sync({ alter: true });

     const existingAdmin = await User.findOne({ where: { username: 'admin' } });

     if (!existingAdmin) {
       const hashedPassword = await bcrypt.hash('admin123', 10);
       const admin = await User.create({
         username: 'admin',
         password: hashedPassword,
         name: 'Admin User'
       });

       const existingProjects = await Project.count();

       if (existingProjects === 0) {
         // Insertar proyectos y tareas de prueba
        const project1 = await Project.create({ 
          title: 'Project 1', 
          description: 'First test project',
          priority: 'high',
          culmination_date: new Date(2024, 6, 15) // Ejemplo: 15 de junio de 2024
        });

        const project2 = await Project.create({ 
          title: 'Project 2', 
          description: 'Second test project',
          priority: 'medium'
        });
    
        await Task.create({ 
          title: 'Task 1', 
          description: 'First task', 
          projectId: project1.id,
          status: 'in_progress'
        });

        await Task.create({ 
          title: 'Task 2', 
          description: 'Second task', 
          projectId: project1.id,
          status: 'pending'
        });
        
        await Task.create({ 
          title: 'Task 3', 
          description: 'Third task', 
          projectId: project2.id,
          status: 'completed',
          completion_date: new Date()
        });
       }

       console.log('Database initialized with sample data');
     } else {
       console.log('Database already contains sample data, skipping initialization');
     }

     // Modificación importante: no salir en producción
     return true;
   } catch (error) {
     console.error('Error initializing database:', error);
     throw error; // Lanzar el error en lugar de salir
   }
}

// Modificación para permitir importación y ejecución directa
if (require.main === module) {
  initDB()
    .then(() => {
      console.log('Database initialization complete');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Database initialization failed:', error);
      process.exit(1);
    });
}

module.exports = initDB;