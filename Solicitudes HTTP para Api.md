# Pruebas unitarias para SmartTask API - Ejemplos para Postman

## Configuración general

URL base: https://smarttask-backend-tcsj.onrender.com/api

Para todas las solicitudes que requieran autenticación, necesitarás agregar el token JWT en el encabezado:
- Key: x-auth-token
- Value: {{auth_token}}

Para configurar la variable de entorno en Postman:
1. Crea una variable de entorno llamada "auth_token"
2. Después de iniciar sesión, guarda el token recibido en esta variable

## 1. Pruebas de autenticación

### 1.1 Registro de usuario
- Método: POST
- URL: {{baseUrl}}/auth/register
- Headers: 
  - Content-Type: application/json
- Body (raw JSON):
```json
{
  "username": "test_user_{{$timestamp}}",
  "password": "Test1234!",
  "name": "Usuario de Prueba"
}
```
- Test script (para guardar automáticamente el token):
```javascript
if (pm.response.code === 200 || pm.response.code === 201) {
    var jsonData = pm.response.json();
    pm.environment.set("auth_token", jsonData.token);
    pm.environment.set("current_username", request.data.username);
    console.log("Token guardado: " + jsonData.token);
}
```
- Resultado esperado: 
  - Código: 201
  - Mensaje de éxito con token JWT

### 1.2 Inicio de sesión
- Método: POST
- URL: {{baseUrl}}/auth/login
- Headers: 
  - Content-Type: application/json
- Body (raw JSON):
```json
{
  "username": "{{current_username}}",
  "password": "Test1234!"
}
```
- Test script:
```javascript
if (pm.response.code === 200) {
    var jsonData = pm.response.json();
    pm.environment.set("auth_token", jsonData.token);
    console.log("Token guardado: " + jsonData.token);
}
```
- Resultado esperado: 
  - Código: 200
  - Mensaje de éxito con token JWT

### 1.3 Cierre de sesión
- Método: POST
- URL: {{baseUrl}}/auth/logout
- Headers: 
  - x-auth-token: {{auth_token}}
- Resultado esperado: 
  - Código: 200
  - Mensaje de cierre de sesión exitoso

## 2. Pruebas de gestión de proyectos

### 2.1 Crear un nuevo proyecto
- Método: POST
- URL: {{baseUrl}}/projects
- Headers: 
  - Content-Type: application/json
  - x-auth-token: {{auth_token}}
- Body (raw JSON):
```json
{
  "title": "Proyecto de prueba {{$timestamp}}",
  "description": "Este es un proyecto creado para probar la API",
  "creation_date": "{{$isoTimestamp}}",
  "culmination_date": "{{$isoTimestamp}}",
  "priority": "medium"
}
```
- Test script:
```javascript
if (pm.response.code === 201) {
    var jsonData = pm.response.json();
    pm.environment.set("project_id", jsonData.id);
    console.log("ID del proyecto guardado: " + jsonData.id);
}
```
- Resultado esperado: 
  - Código: 201
  - Detalles del proyecto creado con ID

### 2.2 Obtener todos los proyectos
- Método: GET
- URL: {{baseUrl}}/projects
- Headers: 
  - x-auth-token: {{auth_token}}
- Resultado esperado: 
  - Código: 200
  - Array de proyectos

### 2.3 Obtener un proyecto específico
- Método: GET
- URL: {{baseUrl}}/projects/{{project_id}}
- Headers: 
  - x-auth-token: {{auth_token}}
- Resultado esperado: 
  - Código: 200
  - Detalles del proyecto

### 2.4 Actualizar un proyecto
- Método: PUT
- URL: {{baseUrl}}/projects/{{project_id}}
- Headers: 
  - Content-Type: application/json
  - x-auth-token: {{auth_token}}
- Body (raw JSON):
```json
{
  "title": "Proyecto actualizado {{$timestamp}}",
  "description": "Descripción actualizada para probar la API",
  "culmination_date": "{{$isoTimestamp}}",
  "priority": "high"
}
```
- Resultado esperado: 
  - Código: 200
  - Detalles del proyecto actualizado

### 2.5 Eliminar un proyecto
- Método: DELETE
- URL: {{baseUrl}}/projects/{{project_id}}
- Headers: 
  - x-auth-token: {{auth_token}}
- Resultado esperado: 
  - Código: 200
  - Mensaje de confirmación de eliminación

## 3. Pruebas de gestión de tareas

### 3.1 Crear un nuevo proyecto para tareas
- Método: POST
- URL: {{baseUrl}}/projects
- Headers: 
  - Content-Type: application/json
  - x-auth-token: {{auth_token}}
- Body (raw JSON):
```json
{
  "title": "Proyecto para tareas {{$timestamp}}",
  "description": "Este proyecto se utilizará para probar las tareas",
  "creation_date": "{{$isoTimestamp}}",
  "culmination_date": "{{$isoTimestamp}}",
  "priority": "medium"
}
```
- Test script:
```javascript
if (pm.response.code === 201) {
    var jsonData = pm.response.json();
    pm.environment.set("task_project_id", jsonData.id);
    console.log("ID del proyecto para tareas guardado: " + jsonData.id);
}
```

### 3.2 Crear una nueva tarea
- Método: POST
- URL: {{baseUrl}}/tasks
- Headers: 
  - Content-Type: application/json
  - x-auth-token: {{auth_token}}
- Body (raw JSON):
```json
{
  "title": "Tarea de prueba {{$timestamp}}",
  "description": "Esta es una tarea creada para probar la API",
  "creation_date": "{{$isoTimestamp}}",
  "completion_date": "{{$isoTimestamp}}",
  "status": "pending",
  "projectId": {{task_project_id}}
}
```
- Test script:
```javascript
if (pm.response.code === 201) {
    var jsonData = pm.response.json();
    pm.environment.set("task_id", jsonData.id);
    console.log("ID de la tarea guardado: " + jsonData.id);
}
```
- Resultado esperado: 
  - Código: 201
  - Detalles de la tarea creada con ID

### 3.3 Obtener todas las tareas
- Método: GET
- URL: {{baseUrl}}/tasks
- Headers: 
  - x-auth-token: {{auth_token}}
- Resultado esperado: 
  - Código: 200
  - Array de tareas

### 3.4 Obtener tareas por proyecto
- Método: GET
- URL: {{baseUrl}}/tasks/project/{{task_project_id}}
- Headers: 
  - x-auth-token: {{auth_token}}
- Resultado esperado: 
  - Código: 200
  - Array de tareas del proyecto especificado

### 3.5 Obtener una tarea específica
- Método: GET
- URL: {{baseUrl}}/tasks/{{task_id}}
- Headers: 
  - x-auth-token: {{auth_token}}
- Resultado esperado: 
  - Código: 200
  - Detalles de la tarea

### 3.6 Actualizar una tarea
- Método: PUT
- URL: {{baseUrl}}/tasks/{{task_id}}
- Headers: 
  - Content-Type: application/json
  - x-auth-token: {{auth_token}}
- Body (raw JSON):
```json
{
  "title": "Tarea actualizada {{$timestamp}}",
  "description": "Descripción actualizada para probar la API",
  "status": "in_progress",
  "completion_date": "{{$isoTimestamp}}"
}
```
- Resultado esperado: 
  - Código: 200
  - Detalles de la tarea actualizada

### 3.7 Eliminar una tarea
- Método: DELETE
- URL: {{baseUrl}}/tasks/{{task_id}}
- Headers: 
  - x-auth-token: {{auth_token}}
- Resultado esperado: 
  - Código: 200
  - Mensaje de confirmación de eliminación

## 4. Pruebas de manejo de errores

### 4.1 Acceso no autorizado
- Método: GET
- URL: {{baseUrl}}/projects
- (No incluir token de autenticación)
- Resultado esperado: 
  - Código: 401
  - Mensaje de error de autenticación

### 4.2 Formato de datos inválido
- Método: POST
- URL: {{baseUrl}}/projects
- Headers: 
  - Content-Type: application/json
  - x-auth-token: {{auth_token}}
- Body (raw JSON):
```json
{
  "title": "",
  "description": "Proyecto con datos inválidos",
  "priority": "invalid_priority"
}
```
- Resultado esperado: 
  - Código: 400
  - Mensaje de error de validación

### 4.3 Recurso no encontrado
- Método: GET
- URL: {{baseUrl}}/projects/999999
- Headers: 
  - x-auth-token: {{auth_token}}
- Resultado esperado: 
  - Código: 404
  - Mensaje de recurso no encontrado

## 5. Pruebas de integración

### 5.1 Flujo completo de usuario
Esta prueba simula el flujo completo de un usuario desde el registro hasta la gestión de proyectos y tareas.

1. Registrar un nuevo usuario
2. Iniciar sesión
3. Crear un nuevo proyecto
4. Obtener los detalles del proyecto
5. Crear una tarea asociada al proyecto
6. Actualizar el estado de la tarea a "in_progress"
7. Obtener las tareas del proyecto
8. Actualizar la tarea a "completed"
9. Eliminar la tarea
10. Eliminar el proyecto
11. Cerrar sesión

### 5.2 Prueba de rendimiento
Para evaluar el tiempo de respuesta de la API, puedes crear una colección en Postman que ejecute múltiples solicitudes en secuencia y mida el tiempo de respuesta.

## 6. Prueba de la ruta de depuración

### 6.1 Verificar estado de la API
- Método: GET
- URL: {{baseUrl}}/debug
- Resultado esperado: 
  - Código: 200
  - Información sobre el estado de la API

## Notas importantes:

1. Sustituye `{{baseUrl}}` por `https://smarttask-backend-tcsj.onrender.com/api` si no estás utilizando variables de entorno en Postman.

2. Los tokens JWT tienen un tiempo de expiración. Si recibes un error 401 después de un tiempo, necesitarás iniciar sesión nuevamente para obtener un nuevo token.

3. Estas pruebas están diseñadas para ejecutarse en orden. Algunas pruebas dependen de los resultados de pruebas anteriores (como obtener IDs o tokens).

4. Puedes crear una colección de Postman con estas pruebas y ejecutarlas automáticamente utilizando los scripts de prueba para validar los resultados.

5. Para pruebas más exhaustivas, considera automatizarlas utilizando herramientas como Jest, Mocha o Supertest en un entorno Node.js.

6. Si estás realizando pruebas frecuentes, considera implementar un mecanismo de limpieza para eliminar los datos de prueba creados.