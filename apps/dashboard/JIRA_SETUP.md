# 📊 Dashboard de Sprints de Jira - Guía de Configuración

## 🚀 Configuración Rápida

### 1. Configurar las credenciales de Jira

Edita el archivo `.env` con tus datos de Jira:

```env
VITE_JIRA_BASE_URL=https://tu-empresa.atlassian.net
VITE_JIRA_EMAIL=tu-email@empresa.com
VITE_JIRA_API_TOKEN=tu-token-api
VITE_JIRA_BOARD_ID=1
```

### 2. Obtener el API Token de Jira

1. Ve a: https://id.atlassian.com/manage-profile/security/api-tokens
2. Click en "Create API token"
3. Dale un nombre descriptivo (ej: "Dashboard Sprint")
4. Copia el token generado y pégalo en el archivo `.env`

### 3. Encontrar el Board ID

1. Abre tu tablero de Jira
2. Mira la URL, será algo como: `https://tu-empresa.atlassian.net/jira/software/projects/PROJ/boards/123`
3. El número al final (123 en este ejemplo) es tu Board ID

### 4. Iniciar el Dashboard

```bash
bun install
bun run dev
```

Abre http://localhost:3000 en tu navegador

## 📈 Características del Dashboard

### Vista Ejecutiva
- **KPIs en tiempo real**: Tareas completadas, story points, velocidad del equipo
- **Progreso del Sprint**: Visualización clara del avance con indicadores de estado
- **Alertas automáticas**: Identifica tareas bloqueadas y miembros que necesitan apoyo

### Gráficos Gerenciales
- **Burndown Chart**: Progreso diario vs ideal con análisis de desviación
- **Velocidad del Equipo**: Histórico de los últimos 5 sprints con tendencias
- **Distribución de Trabajo**: Por tipo de tarea, prioridad y asignación

### Gestión del Equipo
- **Top Performers**: Ranking de los 3 mejores colaboradores del sprint
- **Rendimiento Individual**: Análisis detallado por miembro del equipo
- **Eficiencia del Equipo**: Métricas de productividad con recomendaciones

### Tabla de Tareas Interactiva
- **Filtros avanzados**: Por estado, prioridad, tipo y asignado
- **Búsqueda en tiempo real**: Encuentra tareas específicas rápidamente
- **Links directos a Jira**: Acceso rápido a los detalles completos

## 🔧 Personalización

### Ajustar el campo de Story Points

Si tu Jira usa un campo diferente para los story points, modifica en `src/services/jira.ts`:

```typescript
// Busca esta línea y cambia customfield_10016 por tu campo
customfield_10016?: number // Story points field
```

### Cambiar intervalo de actualización

Por defecto, el dashboard se actualiza cada 60 segundos. Para cambiarlo, modifica en `src/pages/SprintDashboard.tsx`:

```typescript
refetchInterval: 60000 // Cambiar a milisegundos deseados
```

## 📝 Notas Importantes

- **Permisos**: Tu usuario de Jira debe tener permisos de lectura en el proyecto
- **CORS**: Si encuentras errores de CORS, puede que necesites configurar un proxy
- **Límites de API**: Jira tiene límites de rate, el dashboard está optimizado para minimizar llamadas

## 🎯 Uso para Gerencia

Este dashboard está diseñado específicamente para gerentes no técnicos:

1. **Resumen Ejecutivo**: Información clave en la parte superior
2. **Indicadores visuales**: Colores y iconos que facilitan la interpretación
3. **Recomendaciones automáticas**: Sugerencias basadas en el análisis de datos
4. **Métricas concretas**: Números claros sin jerga técnica

## 🆘 Solución de Problemas

### Error de autenticación
- Verifica que el email y token sean correctos
- Asegúrate de que el token no haya expirado

### No se muestran datos
- Confirma que el Board ID es correcto
- Verifica que hay un sprint activo en el tablero

### Dashboard vacío
- Revisa la consola del navegador (F12) para ver errores
- Confirma que las variables de entorno están configuradas

## 📞 Soporte

Para ayuda adicional con la configuración de Jira:
- Documentación de Jira API: https://developer.atlassian.com/cloud/jira/platform/rest/v3/
- Guía de API Tokens: https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/