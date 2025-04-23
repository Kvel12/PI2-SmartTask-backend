# SmartTask Project Manager - Backend API

[![Deployed on Render](https://img.shields.io/badge/Render-Deployed-success)](https://smarttask-backend-tcsj.onrender.com/)

## 📋 Descripción

Este repositorio contiene el backend de SmartTask, una aplicación modular de gestión de proyectos y tareas. La API RESTful proporciona endpoints para la autenticación de usuarios, gestión de proyectos y tareas, utilizando un modelo de arquitectura modular que separa el frontend, backend y base de datos en servicios independientes.

## ✨ Características

- **API RESTful**: Diseño modular y escalable
- **Autenticación JWT**: Sistema seguro de tokens para proteger rutas
- **Modelo de datos relacional**: Relaciones bien definidas entre proyectos y tareas
- **Validación de datos**: Validación de entradas para mantener la integridad de los datos
- **Documentación completa**: Cada endpoint está documentado con ejemplos
- **Manejo de errores**: Respuestas de error estructuradas y consistentes
- **Logging**: Sistema de registro para facilitar el mantenimiento

## 🛠️ Tecnologías

- **Node.js**: Entorno de ejecución
- **Express.js**: Framework para API RESTful
- **Sequelize**: ORM para interacción con la base de datos
- **MySQL**: Base de datos relacional
- **JSON Web Tokens**: Autenticación y autorización
- **bcrypt.js**: Encriptación segura de contraseñas
- **Winston**: Logging

## 🚀 Instalación y configuración local

1. Clona el repositorio:
   ```bash
   git clone https://github.com/[tu-usuario]/pi2-smarttask-backend.git
   cd pi2-smarttask-backend
   ```

2. Instala las dependencias:
   ```bash
   npm install
   ```

3. Configura las variables de entorno:
   - Crea un archivo `.env` en la raíz del proyecto
   - Añade las siguientes variables:
     ```
     # Configuración del servidor
     PORT=10000
     NODE_ENV=development

     # Configuración de la base de datos
     DB_HOST=localhost
     DB_USER=root
     DB_PASSWORD=tu_contraseña
     DB_NAME=smarttask_db

     # Configuración JWT
     JWT_SECRET=tu_clave_secreta
     JWT_EXPIRES_IN=1h

     # Configuración de seguridad
     BCRYPT_SALT_ROUNDS=10

     # URLs permitidas para CORS
     FRONTEND_URL=http://localhost:3000
     ```

4. Inicia el servidor:
   ```bash
   npm start
   ```

5. El servidor estará disponible en [http://localhost:10000](http://localhost:10000)

## 📁 Estructura del proyecto

```
.
├── config/             # Configuración de la aplicación
│   └── database.js     # Configuración de la base de datos
├── controllers/        # Lógica de negocio
│   ├── authController.js
│   ├── projectController.js
│   └── taskController.js
├── middleware/         # Middleware de Express
│   ├── auth.js         # Autenticación JWT
│   └── validation.js   # Validación de entradas
├── models/             # Modelos de Sequelize
│   ├── index.js
│   ├── project.js
│   ├── task.js
│   └── user.js
├── routes/             # Definición de rutas
│   ├── auth.js
│   ├── projects.js
│   └── tasks.js
├── logger.js           # Configuración del logger
├── server.js           # Punto de entrada
└── ...
```

## 🔐 Autenticación

La API utiliza autenticación basada en JWT (JSON Web Tokens).

Para obtener un token:
1. Registra un usuario o inicia sesión
2. Incluye el token en el encabezado `x-auth-token` para las solicitudes a rutas protegidas

## 🌐 Endpoints de la API

La API está desplegada en: `https://smarttask-backend-tcsj.onrender.com/api`

### 👤 Autenticación

#### Registro de usuario

```http
POST /api/auth/register
Content-Type: application/json

{
  "username": "usuario_nuevo",
  "password": "contraseña123",
  "name": "Nombre Completo"
}
```

Respuesta:
```json
{
  "message": "User registered successfully.",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Inicio de sesión

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "usuario_nuevo",
  "password": "contraseña123"
}
```

Respuesta:
```json
{
  "message": "Login successful.",
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

#### Cierre de sesión

```http
POST /api/auth/logout
x-auth-token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Respuesta:
```json
{
  "message": "Logout successful."
}
```

### 📂 Proyectos

#### Crear un proyecto

```http
POST /api/projects
x-auth-token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "title": "Nuevo Proyecto",
  "description": "Descripción del proyecto",
  "creation_date": "2024-07-08",
  "culmination_date": "2024-07-15",
  "priority": "high"
}
```

Respuesta:
```json
{
  "id": 1,
  "title": "Nuevo Proyecto",
  "description": "Descripción del proyecto",
  "creation_date": "2024-07-08T00:00:00.000Z",
  "culmination_date": "2024-07-15T00:00:00.000Z",
  "priority": "high",
  "createdAt": "2024-03-26T22:10:00.000Z",
  "updatedAt": "2024-03-26T22:10:00.000Z"
}
```

#### Obtener todos los proyectos

```http
GET /api/projects
x-auth-token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

#### Obtener un proyecto por ID

```http
GET /api/projects/{id}
x-auth-token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

#### Actualizar un proyecto

```http
PUT /api/projects/{id}
x-auth-token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "title": "Proyecto Actualizado",
  "description": "Nueva descripción",
  "culmination_date": "2024-07-20",
  "priority": "medium"
}
```

#### Eliminar un proyecto

```http
DELETE /api/projects/{id}
x-auth-token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

#### Obtener todos los IDs de proyectos

```http
GET /api/projects/all-ids
x-auth-token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 📝 Tareas

#### Crear una tarea

```http
POST /api/tasks
x-auth-token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "title": "Nueva Tarea",
  "description": "Descripción de la tarea",
  "creation_date": "2024-07-08",
  "completion_date": "2024-07-15",
  "status": "pending",
  "projectId": 1
}
```

Respuesta:
```json
{
  "id": 1,
  "title": "Nueva Tarea",
  "description": "Descripción de la tarea",
  "creation_date": "2024-07-08T00:00:00.000Z",
  "completion_date": "2024-07-15T00:00:00.000Z",
  "status": "pending",
  "projectId": 1,
  "createdAt": "2024-03-26T22:15:00.000Z",
  "updatedAt": "2024-03-26T22:15:00.000Z"
}
```

#### Obtener todas las tareas

```http
GET /api/tasks
x-auth-token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

#### Obtener una tarea por ID

```http
GET /api/tasks/{id}
x-auth-token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

#### Obtener tareas por proyecto

```http
GET /api/tasks/project/{projectId}
x-auth-token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

#### Actualizar una tarea

```http
PUT /api/tasks/{id}
x-auth-token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Content-Type: application/json

{
  "title": "Tarea Actualizada",
  "description": "Nueva descripción de la tarea",
  "status": "in_progress",
  "completion_date": "2024-07-18"
}
```

#### Eliminar una tarea

```http
DELETE /api/tasks/{id}
x-auth-token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

## 📊 Modelos de datos

### Usuario
- `id`: Número (PK)
- `username`: String (único)
- `password`: String (encriptada)
- `name`: String
- `createdAt`: Fecha
- `updatedAt`: Fecha

### Proyecto
- `id`: Número (PK)
- `title`: String
- `description`: String
- `creation_date`: Fecha
- `culmination_date`: Fecha
- `priority`: Enum ('high', 'medium', 'low')
- `createdAt`: Fecha
- `updatedAt`: Fecha

### Tarea
- `id`: Número (PK)
- `title`: String
- `description`: String
- `creation_date`: Fecha
- `completion_date`: Fecha
- `status`: Enum ('pending', 'in_progress', 'completed', 'cancelled')
- `projectId`: Número (FK)
- `createdAt`: Fecha
- `updatedAt`: Fecha

## 🐞 Depuración

La API proporciona una ruta de depuración para verificar el estado:

```http
GET /api/debug
```

Respuesta:
```json
{
  "message": "API está funcionando",
  "environment": "production",
  "frontendUrl": "https://pi2-smarttask-frontend.onrender.com",
  "timestamp": "2024-03-26T22:30:00.000Z"
}
```

## 🔄 Integración con el frontend

Este backend está diseñado para trabajar con el frontend desplegado en:

[https://pi2-smarttask-frontend.onrender.com](https://pi2-smarttask-frontend.onrender.com)

## 📝 Licencia

Este proyecto está bajo la Licencia MIT. Ver el archivo `LICENSE` para más detalles.

## 👨‍💻 Autores

- Juan Sebastian Cifuentes Vallejo - 202179800
- Hernán David Cisneros Vargas - 2178192
- Santiago Duque Chacón - 202180099
- Nicolas Fernando Huertas Cadavid - 202180569
- Miguel Ángel Moreno Romero - 202125737
- Kevin Alejandro Velez Agudelo - 2123281