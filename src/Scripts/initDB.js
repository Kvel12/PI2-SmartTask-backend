const path = require('path');
const { sequelize, User, Project, Task } = require(path.join(__dirname, '..', 'models'));
const bcrypt = require('bcryptjs');

async function initDB() {
  try {
    // En producción, es mejor usar alter: true en lugar de force: true
    // para no perder datos existentes
    await sequelize.sync({ alter: true });
    
    // Verificar si ya existe el usuario admin
    const existingAdmin = await User.findOne({ where: { username: 'admin' } });
    
    if (!existingAdmin) {
      const hashedPassword = await bcrypt.hash('admin123', 10);
      const admin = await User.create({
        username: 'admin',
        password: hashedPassword,
        name: 'Admin User'
      });
      
      // Crear datos de prueba solo si es necesario
      const existingProjects = await Project.count();
      
      if (existingProjects === 0) {
        // Insertar proyectos y tareas de prueba
        // ... tu código existente para crear proyectos y tareas
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
    
    if (process.env.NODE_ENV !== 'production') {
      process.exit(0);
    }
  } catch (error) {
    console.error('Error initializing database:', error);
    if (process.env.NODE_ENV !== 'production') {
      process.exit(1);
    }
  }
}

// Solo ejecutar si se llama directamente (no como parte del arranque del servidor)
if (require.main === module) {
  initDB();
}

module.exports = initDB;