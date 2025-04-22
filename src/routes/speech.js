// routes/speech.js
const express = require('express');
const router = express.Router();
const multer = require('multer');
const speech = require('@google-cloud/speech');
const { OpenAI } = require('openai');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const auth = require('../middleware/auth');
const { Task, Project } = require('../models');
const { Op } = require('sequelize');

// Configuración de multer para manejar archivos de audio
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    
    // Asegurarse de que el directorio exista
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const extension = file.originalname.split('.').pop();
    cb(null, `${uuidv4()}.${extension}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // Límite de 5MB
  },
  fileFilter: (req, file, cb) => {
    // Validar el tipo de archivo
    const allowedMimeTypes = ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Formato de archivo no soportado'), false);
    }
  }
});

/// Configurar el cliente de Google Speech-to-Text
// Configurar el cliente de Google Speech-to-Text
let speechClient;
try {
  speechClient = new speech.SpeechClient({
    credentials: JSON.parse(process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON),
  });
} catch (error) {
  console.error('Error al configurar Google Speech-to-Text:', error);
}

// Configurar el cliente de OpenAI (free-tier o modelo de bajo costo)
let openai;
try {
  openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
  });
} catch (error) {
  console.error('Error al configurar OpenAI:', error);
}

// Endpoint para convertir audio a texto
router.post('/speech-to-text', auth, upload.single('audio'), async (req, res) => {
  try {
    if (!speechClient) {
      return res.status(500).json({ error: 'Google Speech-to-Text no está configurado correctamente' });
    }

    if (!req.file) {
      return res.status(400).json({ error: 'No se recibió ningún archivo de audio' });
    }

    // Leer el archivo de audio
    const audioBytes = fs.readFileSync(req.file.path).toString('base64');
    
    // Determinar el encoding basado en el tipo de archivo
    let encoding = 'LINEAR16';
    if (req.file.mimetype === 'audio/webm') {
      encoding = 'WEBM_OPUS';
    } else if (req.file.mimetype === 'audio/ogg') {
      encoding = 'OGG_OPUS';
    } else if (req.file.mimetype === 'audio/mpeg') {
      encoding = 'MP3';
    }
    
    // Configurar la solicitud para Google Speech-to-Text
    const request = {
      audio: {
        content: audioBytes,
      },
      config: {
        encoding: encoding,
        sampleRateHertz: 16000,
        languageCode: 'es-ES', // Español (España)
        alternativeLanguageCodes: ['es-MX', 'es-CO', 'es-AR', 'es-CL', 'en-US'], // Soporte para variantes regionales
        enableAutomaticPunctuation: true,
        model: 'default',
        useEnhanced: true, // Usar modelo mejorado para mejor precisión
      },
    };

    console.log(`Procesando audio (${req.file.size} bytes) con encoding ${encoding}`);

    // Realizar la solicitud a Google Speech-to-Text
    const [response] = await speechClient.recognize(request);
    
    // Extraer la transcripción
    const transcription = response.results
      .map(result => result.alternatives[0].transcript)
      .join('\n');
    
    console.log('Transcripción completada:', transcription);

    // Eliminar el archivo de audio temporal
    fs.unlinkSync(req.file.path);

    res.json({ success: true, transcription });
  } catch (error) {
    console.error('Error en speech-to-text:', error);
    
    // Limpiar el archivo en caso de error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({ 
      error: 'Error al procesar el audio',
      details: error.message 
    });
  }
});

// Endpoint para procesar comandos de voz con un LLM
router.post('/process-voice-command', auth, async (req, res) => {
  const { transcription, commandType, projectId } = req.body;
  
  if (!transcription) {
    return res.status(400).json({ error: 'La transcripción es requerida' });
  }

  if (!openai) {
    return res.status(500).json({ error: 'OpenAI no está configurado correctamente' });
  }

  try {
    // Preprocesar la transcripción para detectar el tipo de comando
    let detectedCommandType = commandType;
    
    if (!detectedCommandType) {
      // Si no se especificó un tipo de comando, intentar detectarlo automáticamente
      detectedCommandType = await detectCommandType(transcription);
    }
    
    // Generar respuesta según el tipo de comando detectado
    let response;
    
    switch (detectedCommandType) {
      case 'createTask':
        response = await processCreateTaskCommand(transcription, projectId);
        break;
      case 'searchTask':
        response = await processSearchTaskCommand(transcription);
        break;
      case 'updateTask':
        response = await processUpdateTaskCommand(transcription);
        break;
      case 'assistance':
      default:
        response = await processAssistanceCommand(transcription);
        break;
    }
    
    res.json(response);
  } catch (error) {
    console.error('Error al procesar el comando de voz:', error);
    res.status(500).json({ 
      success: false,
      error: 'Error al procesar el comando de voz',
      details: error.message 
    });
  }
});

// Detectar automáticamente el tipo de comando basado en la transcripción
async function detectCommandType(transcription) {
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: "Eres un asistente especializado en detectar tipos de comandos de voz para un sistema de gestión de tareas. Tu función es analizar la transcripción y determinar de qué tipo es." 
        },
        { 
          role: "user", 
          content: `Analiza esta transcripción: "${transcription}" y clasifícala en una de estas categorías: "createTask" (si está solicitando crear una tarea), "searchTask" (si está buscando tareas), "updateTask" (si está actualizando una tarea existente), "assistance" (si está pidiendo ayuda o información general). Responde solo con el tipo, sin explicación.` 
        }
      ],
      temperature: 0.3,
    });

    // Extraer el tipo de comando identificado
    const detectedType = completion.choices[0].message.content.trim().toLowerCase();
    
    // Validar que el tipo sea uno de los aceptados
    if (['createtask', 'searchtask', 'updatetask', 'assistance'].includes(detectedType.toLowerCase())) {
      return detectedType;
    }
    
    // Si no coincide con ninguno de los tipos esperados, devolver "assistance" por defecto
    return 'assistance';
  } catch (error) {
    console.error('Error al detectar tipo de comando:', error);
    return 'assistance'; // Por defecto, tratar como una solicitud de asistencia
  }
}

// Procesar un comando para crear una tarea
async function processCreateTaskCommand(transcription, projectId) {
  try {
    // Verificar que el proyecto existe
    if (projectId) {
      const project = await Project.findByPk(projectId);
      if (!project) {
        return {
          success: false,
          error: 'Proyecto no encontrado'
        };
      }
    }

    // Usar LLM para extraer detalles de la tarea desde la transcripción
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: `Eres un asistente especializado en extraer detalles de tareas para un sistema de gestión de proyectos. 
          Estructura de una tarea:
          - title: Título de la tarea (obligatorio)
          - description: Descripción de la tarea (opcional)
          - status: Estado de la tarea (in_progress, completed, pending, cancelled)
          - completion_date: Fecha límite de la tarea en formato YYYY-MM-DD` 
        },
        { 
          role: "user", 
          content: `Analiza esta transcripción: "${transcription}" 
          Extrae los detalles de la tarea que se está solicitando crear. 
          Devuelve SOLO un objeto JSON con los campos title, description, status y completion_date.
          Si no hay información sobre algún campo, déjalo como null o con un valor por defecto apropiado.
          Para completion_date, si no se especifica una fecha exacta pero se menciona un plazo (como "para mañana" o "en una semana"), calcula la fecha correspondiente.
          Para status, si no se especifica, usa "pending" como valor por defecto.` 
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    // Extraer y analizar la respuesta
    const taskDetails = JSON.parse(completion.choices[0].message.content);
    
    // Validar que al menos tengamos un título
    if (!taskDetails.title) {
      return {
        success: false,
        error: 'No se pudo identificar el título de la tarea'
      };
    }

    // Asegurar que tengamos valores para todos los campos
    const formattedTaskDetails = {
      title: taskDetails.title,
      description: taskDetails.description || '',
      status: taskDetails.status || 'pending',
      completion_date: taskDetails.completion_date || new Date().toISOString().split('T')[0],
      projectId: projectId
    };

    // Opcionalmente, crear la tarea en la base de datos aquí
    // const newTask = await Task.create(formattedTaskDetails);

    return {
      success: true,
      action: 'createTask',
      taskDetails: formattedTaskDetails
    };
  } catch (error) {
    console.error('Error al procesar comando de creación de tarea:', error);
    return {
      success: false,
      error: 'Error al procesar el comando',
      details: error.message
    };
  }
}

// Procesar un comando para buscar tareas
async function processSearchTaskCommand(transcription) {
  try {
    // Usar LLM para extraer criterios de búsqueda desde la transcripción
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: `Eres un asistente especializado en extraer criterios de búsqueda para un sistema de gestión de tareas.` 
        },
        { 
          role: "user", 
          content: `Analiza esta transcripción: "${transcription}" 
          Extrae los criterios de búsqueda para tareas, que pueden incluir:
          - searchTerm: palabras clave para buscar en el título o descripción
          - status: estado de las tareas (in_progress, completed, pending, cancelled)
          - dateRange: rango de fechas en formato {from: "YYYY-MM-DD", to: "YYYY-MM-DD"}
          - projectId: identificador del proyecto, si se menciona uno específico
          
          Devuelve SOLO un objeto JSON con estos campos. Si algún criterio no está presente, omítelo del objeto.` 
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    // Extraer y analizar la respuesta
    const searchParams = JSON.parse(completion.choices[0].message.content);
    
    // Construir la respuesta
    return {
      success: true,
      action: 'searchTasks',
      searchParams
    };
  } catch (error) {
    console.error('Error al procesar comando de búsqueda:', error);
    return {
      success: false,
      error: 'Error al procesar el comando de búsqueda',
      details: error.message
    };
  }
}

// Procesar un comando para actualizar una tarea
async function processUpdateTaskCommand(transcription) {
  try {
    // Usar LLM para extraer detalles de la actualización
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: `Eres un asistente especializado en extraer detalles para actualizar tareas en un sistema de gestión de proyectos.` 
        },
        { 
          role: "user", 
          content: `Analiza esta transcripción: "${transcription}" 
          Extrae los detalles de la actualización de tarea, incluyendo:
          - taskIdentifier: Palabras exactas o número que identifique la tarea a actualizar
          - updates: Objeto con los campos a actualizar, que pueden incluir:
            - title: Nuevo título
            - description: Nueva descripción
            - status: Nuevo estado (in_progress, completed, pending, cancelled)
            - completion_date: Nueva fecha límite en formato YYYY-MM-DD
          
          Devuelve SOLO un objeto JSON con estos campos. Incluye en 'updates' solo los campos que realmente se van a actualizar.` 
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
    });

    // Extraer y analizar la respuesta
    const updateDetails = JSON.parse(completion.choices[0].message.content);
    
    // Validar que tengamos un identificador y al menos un campo a actualizar
    if (!updateDetails.taskIdentifier || !updateDetails.updates || Object.keys(updateDetails.updates).length === 0) {
      return {
        success: false,
        error: 'No se pudo identificar la tarea o los campos a actualizar'
      };
    }

    return {
      success: true,
      action: 'updateTask',
      updateDetails
    };
  } catch (error) {
    console.error('Error al procesar comando de actualización:', error);
    return {
      success: false,
      error: 'Error al procesar el comando de actualización',
      details: error.message
    };
  }
}

// Procesar un comando de asistencia general
async function processAssistanceCommand(transcription) {
  try {
    // Usar LLM para generar una respuesta de asistencia
    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        { 
          role: "system", 
          content: `Eres un asistente virtual para un sistema de gestión de tareas llamado SmartTask. 
          Puedes ayudar con información sobre cómo usar la aplicación, responder preguntas sobre gestión de proyectos y tareas, 
          y ofrecer consejos para mejorar la productividad.
          
          Características de SmartTask:
          - Creación y gestión de proyectos con títulos, descripciones, fechas y prioridades
          - Creación y gestión de tareas dentro de cada proyecto
          - Las tareas tienen título, descripción, estado y fecha límite
          - Estados de tarea: pendiente, en progreso, completada, cancelada
          - Visualización de estadísticas en un dashboard
          
          Mantén tus respuestas concisas, útiles y enfocadas en ayudar al usuario con su sistema de gestión de tareas.` 
        },
        { 
          role: "user", 
          content: `El usuario ha dicho: "${transcription}"
          Proporciona una respuesta útil y concisa. No uses más de 3-4 oraciones.` 
        }
      ],
      temperature: 0.7,
    });

    // Extraer la respuesta
    const assistantResponse = completion.choices[0].message.content.trim();
    
    return {
      success: true,
      response: assistantResponse
    };
  } catch (error) {
    console.error('Error al procesar comando de asistencia:', error);
    return {
      success: false,
      error: 'Error al procesar la solicitud de asistencia',
      details: error.message
    };
  }
}

module.exports = router;