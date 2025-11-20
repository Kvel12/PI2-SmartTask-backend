# 📋 Kanban Templates Implementation Guide

## Overview
This guide explains how to use the new dynamic Kanban board feature with predefined templates for different project types.

---

## 🎯 New Fields in Project Model

### 1. `kanban_template` (ENUM)
- **Type**: String (ENUM)
- **Values**: `'default'`, `'architecture'`, `'systems_engineering'`
- **Default**: `'default'`
- **Description**: Identifier for the selected Kanban template

### 2. `kanban_columns` (JSONB Array)
- **Type**: JSONB (PostgreSQL)
- **Required**: Yes (minimum 1 column)
- **Description**: Array of column objects defining the Kanban board structure

**Column Object Structure**:
```json
{
  "id": "requirements",        // Unique identifier (used in task.status)
  "title": "Requerimientos",   // Display name
  "color": "#e91e63",          // Hex color code
  "icon": "📝"                 // Emoji or icon
}
```

---

## 📚 Predefined Templates

### Template 1: Default (Standard Project)
```json
{
  "kanban_template": "default",
  "kanban_columns": [
    { "id": "pending", "title": "Pending", "color": "#ffc107", "icon": "📋" },
    { "id": "in_progress", "title": "In Progress", "color": "#007bff", "icon": "🔄" },
    { "id": "completed", "title": "Completed", "color": "#28a745", "icon": "✅" },
    { "id": "cancelled", "title": "Cancelled", "color": "#6c757d", "icon": "❌" }
  ]
}
```

**Best for**: General purpose projects, task management, simple workflows

---

### Template 2: Software Architecture
```json
{
  "kanban_template": "architecture",
  "kanban_columns": [
    { "id": "requirements", "title": "Requerimientos", "color": "#e91e63", "icon": "📝" },
    { "id": "design", "title": "Diseño", "color": "#9c27b0", "icon": "🎨" },
    { "id": "construction", "title": "Construcción", "color": "#2196f3", "icon": "🏗️" },
    { "id": "validation", "title": "Validación", "color": "#4caf50", "icon": "✔️" }
  ]
}
```

**Best for**: Software development, architecture projects, SDLC workflows

---

### Template 3: Systems Engineering
```json
{
  "kanban_template": "systems_engineering",
  "kanban_columns": [
    { "id": "todo", "title": "Por hacer", "color": "#ff9800", "icon": "📌" },
    { "id": "in_progress", "title": "En progreso", "color": "#03a9f4", "icon": "⚙️" },
    { "id": "review", "title": "En revisión", "color": "#ff5722", "icon": "🔍" },
    { "id": "completed", "title": "Completado", "color": "#8bc34a", "icon": "✅" }
  ]
}
```

**Best for**: Engineering projects, systems analysis, technical reviews

---

## 🛠️ Setup Instructions

### Step 1: Run Database Migration

```bash
cd /home/brandon/programming/temp/PI2-SmartTask-backend

# If using Sequelize CLI (if you have it configured)
npx sequelize-cli db:migrate

# Otherwise, you can run the migration manually or sync the models
# The model will auto-sync when you start the server
```

### Step 2: Start the Backend Server

```bash
npm start
```

The server should sync the new columns to the database automatically.

---

## 🧪 API Testing Examples

### Test 1: Create Project with Default Template

**Request**:
```bash
curl -X POST http://localhost:5500/api/projects \
  -H "Content-Type: application/json" \
  -H "x-auth-token: YOUR_JWT_TOKEN" \
  -d '{
    "title": "General Project Management",
    "description": "Standard workflow project",
    "priority": "medium",
    "kanban_template": "default"
  }'
```

**Expected Response**:
```json
{
  "id": 1,
  "title": "General Project Management",
  "description": "Standard workflow project",
  "priority": "medium",
  "kanban_template": "default",
  "kanban_columns": [
    { "id": "pending", "title": "Pending", "color": "#ffc107", "icon": "📋" },
    { "id": "in_progress", "title": "In Progress", "color": "#007bff", "icon": "🔄" },
    { "id": "completed", "title": "Completed", "color": "#28a745", "icon": "✅" },
    { "id": "cancelled", "title": "Cancelled", "color": "#6c757d", "icon": "❌" }
  ],
  "creation_date": "2024-11-20",
  "culmination_date": null,
  "createdAt": "2024-11-20T10:30:00.000Z",
  "updatedAt": "2024-11-20T10:30:00.000Z"
}
```

---

### Test 2: Create Project with Architecture Template

**Request**:
```bash
curl -X POST http://localhost:5500/api/projects \
  -H "Content-Type: application/json" \
  -H "x-auth-token: YOUR_JWT_TOKEN" \
  -d '{
    "title": "Banking System Development",
    "description": "Full-stack banking application",
    "priority": "high",
    "culmination_date": "2024-12-31",
    "kanban_template": "architecture",
    "kanban_columns": [
      {"id": "requirements", "title": "Requerimientos", "color": "#e91e63", "icon": "📝"},
      {"id": "design", "title": "Diseño", "color": "#9c27b0", "icon": "🎨"},
      {"id": "construction", "title": "Construcción", "color": "#2196f3", "icon": "🏗️"},
      {"id": "validation", "title": "Validación", "color": "#4caf50", "icon": "✔️"}
    ]
  }'
```

---

### Test 3: Create Task with Valid Status

**Request**:
```bash
curl -X POST http://localhost:5500/api/tasks \
  -H "Content-Type: application/json" \
  -H "x-auth-token: YOUR_JWT_TOKEN" \
  -d '{
    "title": "Define functional requirements",
    "description": "Document all functional requirements for the banking system",
    "status": "requirements",
    "projectId": 2
  }'
```

**Expected Response**: ✅ Success (201)

---

### Test 4: Create Task with Invalid Status (Should Fail)

**Request**:
```bash
curl -X POST http://localhost:5500/api/tasks \
  -H "Content-Type: application/json" \
  -H "x-auth-token: YOUR_JWT_TOKEN" \
  -d '{
    "title": "Invalid task",
    "description": "This should fail",
    "status": "nonexistent_status",
    "projectId": 2
  }'
```

**Expected Response**: ❌ Error (400)
```json
{
  "message": "Invalid status 'nonexistent_status'. Valid statuses for this project: requirements, design, construction, validation"
}
```

---

### Test 5: Update Project Columns (With Task Validation)

**Request**:
```bash
curl -X PUT http://localhost:5500/api/projects/2 \
  -H "Content-Type: application/json" \
  -H "x-auth-token: YOUR_JWT_TOKEN" \
  -d '{
    "kanban_columns": [
      {"id": "backlog", "title": "Backlog", "color": "#795548", "icon": "📦"},
      {"id": "active", "title": "Active", "color": "#2196f3", "icon": "⚡"},
      {"id": "done", "title": "Done", "color": "#4caf50", "icon": "✅"}
    ]
  }'
```

**If tasks exist with old status**: ❌ Error (400)
```json
{
  "message": "Cannot update columns: 2 tasks have invalid status",
  "invalidTasks": [
    { "id": 5, "status": "requirements" },
    { "id": 6, "status": "design" }
  ]
}
```

---

### Test 6: Get All Projects (Verify New Fields)

**Request**:
```bash
curl -X GET http://localhost:5500/api/projects \
  -H "x-auth-token: YOUR_JWT_TOKEN"
```

**Expected Response**: Array of projects with `kanban_template` and `kanban_columns` fields

---

### Test 7: Update Task Status

**Request**:
```bash
curl -X PUT http://localhost:5500/api/tasks/5 \
  -H "Content-Type: application/json" \
  -H "x-auth-token: YOUR_JWT_TOKEN" \
  -d '{
    "status": "design"
  }'
```

**Expected Response**: ✅ Success if `"design"` is a valid column in the project

---

## ⚠️ Important Validations

### 1. **Creating Projects**
- `kanban_template` is optional (defaults to `'default'`)
- `kanban_columns` is optional (uses default template columns)
- If `kanban_columns` is provided, it must be a non-empty array
- Each column must have: `id`, `title`, `color` (valid hex), and `icon`

### 2. **Creating Tasks**
- `status` must match one of the column IDs in the project's `kanban_columns`
- If no `status` is provided, uses the first column by default
- Returns 400 error if status is invalid

### 3. **Updating Tasks**
- `status` validation is performed against the project's current columns
- If moving task to different project, validates against new project's columns

### 4. **Updating Project Columns**
- Checks all existing tasks for the project
- Prevents column update if any task has a status not in the new columns
- Returns error with list of affected tasks

---

## 🎨 Custom Template Example

You can create completely custom columns:

```bash
curl -X POST http://localhost:5500/api/projects \
  -H "Content-Type: application/json" \
  -H "x-auth-token: YOUR_JWT_TOKEN" \
  -d '{
    "title": "Marketing Campaign",
    "description": "Q4 Marketing campaign workflow",
    "priority": "high",
    "kanban_template": "default",
    "kanban_columns": [
      {"id": "ideation", "title": "Ideation", "color": "#ff6b6b", "icon": "💡"},
      {"id": "planning", "title": "Planning", "color": "#4ecdc4", "icon": "📅"},
      {"id": "execution", "title": "Execution", "color": "#45b7d1", "icon": "🚀"},
      {"id": "review", "title": "Review", "color": "#f7b731", "icon": "📊"},
      {"id": "completed", "title": "Completed", "color": "#5f27cd", "icon": "🎉"}
    ]
  }'
```

---

## 🔍 Database Schema Changes

### Projects Table - New Columns

```sql
ALTER TABLE "Projects"
ADD COLUMN "kanban_template" VARCHAR(255) DEFAULT 'default' CHECK ("kanban_template" IN ('default', 'architecture', 'systems_engineering'));

ALTER TABLE "Projects"
ADD COLUMN "kanban_columns" JSONB NOT NULL DEFAULT '[
  {"id": "pending", "title": "Pending", "color": "#ffc107", "icon": "📋"},
  {"id": "in_progress", "title": "In Progress", "color": "#007bff", "icon": "🔄"},
  {"id": "completed", "title": "Completed", "color": "#28a745", "icon": "✅"},
  {"id": "cancelled", "title": "Cancelled", "color": "#6c757d", "icon": "❌"}
]'::jsonb;
```

---

## 📝 Frontend Integration Notes

### For Your Partner (Frontend Developer)

1. **Fetching Projects**: All projects now include `kanban_template` and `kanban_columns` fields
2. **Dynamic Columns**: Use `project.kanban_columns` to render Kanban board columns dynamically
3. **Task Status**: Task `status` field corresponds to `column.id` in the project's columns
4. **Color Coding**: Use `column.color` for visual styling
5. **Icons**: Use `column.icon` for column headers

**Example React Component Logic**:
```javascript
// Fetch project
const project = await api.get(`/projects/${projectId}`);

// Render columns dynamically
{project.kanban_columns.map(column => (
  <KanbanColumn
    key={column.id}
    id={column.id}
    title={column.title}
    color={column.color}
    icon={column.icon}
    tasks={tasks.filter(t => t.status === column.id)}
  />
))}
```

---

## 🐛 Troubleshooting

### Problem: Migration fails with "column already exists"
**Solution**: The columns might have been auto-created by Sequelize sync. Drop them manually or skip migration.

```sql
ALTER TABLE "Projects" DROP COLUMN IF EXISTS "kanban_template";
ALTER TABLE "Projects" DROP COLUMN IF EXISTS "kanban_columns";
```

Then re-run migration.

### Problem: Tasks can't be created with error "Invalid status"
**Solution**: Check that the project has the correct `kanban_columns` and use a valid column ID as status.

### Problem: Can't update project columns - "tasks have invalid status"
**Solution**:
1. Update all task statuses to match new columns first
2. Then update project columns
3. Or delete/complete tasks with old statuses

---

## 📊 Example Workflow

1. **Create Project** with architecture template
2. **Create Tasks** with status `"requirements"`
3. **Move Tasks** by updating status to `"design"`, `"construction"`, etc.
4. **Track Progress** by filtering tasks by status
5. **Complete Tasks** by updating status to `"validation"`

---

## ✅ Testing Checklist

- [ ] Create project with default template
- [ ] Create project with architecture template
- [ ] Create project with systems_engineering template
- [ ] Create project with custom columns
- [ ] Create task with valid status
- [ ] Try creating task with invalid status (should fail)
- [ ] Update task status to different valid column
- [ ] Try updating task with invalid status (should fail)
- [ ] Update project columns when no tasks exist
- [ ] Try updating project columns when tasks have old statuses (should fail)
- [ ] Get all projects and verify new fields are present
- [ ] Get project by ID and verify kanban_columns structure

---

## 🚀 Next Steps

1. Test all endpoints with Postman or cURL
2. Verify database has new columns
3. Integrate with frontend Kanban board component
4. Add template selector UI in project creation form
5. Test task drag-and-drop with dynamic columns

---

## 📞 Support

For questions or issues, contact the backend development team.

**Files Modified**:
- `src/models/project.js` - Added kanban fields
- `src/controllers/projectController.js` - Added kanban validation
- `src/controllers/taskController.js` - Added status validation
- `migrations/20241120000000-add-kanban-fields-to-projects.js` - Database migration

---

**Last Updated**: November 20, 2024
**Version**: 1.0.0
