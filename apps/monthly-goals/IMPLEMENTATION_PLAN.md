# 📊 Sistema de Gestión de Metas Mensuales - Plan de Implementación

## 📋 Resumen Ejecutivo

Sistema web para gestionar y presentar metas departamentales con seguimiento mensual, jerarquía organizacional completa y generación automática de presentaciones tipo dashboard.

## 🎯 Objetivos del Sistema

1. **Gestión Organizacional**: Administrar gerencias, áreas y equipos de trabajo
2. **Tracking de Metas**: Configuración y seguimiento mensual de objetivos individuales
3. **Histórico de Cumplimiento**: Registro histórico de logros por mes/año
4. **Presentaciones Automatizadas**: Generación de dashboards interactivos para reuniones
5. **Control de Acceso**: Sistema de roles y permisos por jerarquía

## 🏗️ Arquitectura Técnica

### Stack Tecnológico

| Componente | Tecnología | Justificación |
|------------|------------|---------------|
| **Framework** | TanStack Start | SSR, routing avanzado, integración con TanStack Query |
| **Base de Datos** | PostgreSQL (Neon) | Escalable, relacional, serverless |
| **ORM** | Drizzle | Type-safe, performante, migraciones automáticas |
| **Autenticación** | Better Auth | Moderna, flexible, integración fácil con TanStack |
| **UI Framework** | Tailwind CSS v4 | Utility-first, personalizable, performance |
| **State Management** | TanStack Query | Cache inteligente, mutations, optimistic updates |
| **Build Tool** | Vite | Rápido, HMR, optimizado para producción |

### Arquitectura de Capas

```
┌─────────────────────────────────────┐
│         Presentation Layer          │
│    (React + TanStack Router)        │
├─────────────────────────────────────┤
│         Business Logic              │
│    (Server Functions + API)         │
├─────────────────────────────────────┤
│         Data Access Layer           │
│      (Drizzle ORM + Neon)          │
├─────────────────────────────────────┤
│           Database                  │
│         (PostgreSQL)                │
└─────────────────────────────────────┘
```

## 📊 Modelo de Datos

### Esquema de Base de Datos

```sql
-- Tabla de usuarios (integrada con Better Auth)
users (
  id UUID PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  role ENUM('super_admin', 'manager', 'employee', 'viewer'),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Gerencias/Departamentos
departments (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  manager_id UUID REFERENCES users(id),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Áreas dentro de cada gerencia
areas (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  department_id UUID REFERENCES departments(id),
  lead_id UUID REFERENCES users(id),
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Miembros del equipo
team_members (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  area_id UUID REFERENCES areas(id),
  position VARCHAR(255),
  joined_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Configuración de metas
goal_templates (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  default_target DECIMAL,
  unit VARCHAR(50), -- 'entregas', 'ventas', 'tickets', etc.
  success_threshold DECIMAL, -- % para verde
  warning_threshold DECIMAL, -- % para amarillo
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Metas mensuales por empleado
monthly_goals (
  id UUID PRIMARY KEY,
  team_member_id UUID REFERENCES team_members(id),
  goal_template_id UUID REFERENCES goal_templates(id),
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  target_value DECIMAL NOT NULL,
  achieved_value DECIMAL DEFAULT 0,
  description TEXT,
  status ENUM('pending', 'in_progress', 'completed'),
  created_at TIMESTAMP,
  updated_at TIMESTAMP,
  UNIQUE(team_member_id, goal_template_id, month, year)
)

-- Presentaciones
presentations (
  id UUID PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  month INTEGER NOT NULL,
  year INTEGER NOT NULL,
  status ENUM('draft', 'ready', 'presented'),
  created_by UUID REFERENCES users(id),
  presented_at TIMESTAMP,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)

-- Registros de metas para presentaciones
goal_submissions (
  id UUID PRIMARY KEY,
  presentation_id UUID REFERENCES presentations(id),
  monthly_goal_id UUID REFERENCES monthly_goals(id),
  submitted_value DECIMAL,
  submitted_by UUID REFERENCES users(id),
  submitted_at TIMESTAMP,
  notes TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
)
```

### Relaciones Clave

```mermaid
graph TD
    D[Departments] -->|1:N| A[Areas]
    A -->|1:N| TM[Team Members]
    TM -->|1:N| MG[Monthly Goals]
    GT[Goal Templates] -->|1:N| MG
    P[Presentations] -->|1:N| GS[Goal Submissions]
    MG -->|1:1| GS
    U[Users] -->|1:N| TM
    U -->|manages| D
    U -->|leads| A
```

## 🔐 Sistema de Autenticación y Roles

### Roles y Permisos

| Rol | Permisos | Descripción |
|-----|----------|-------------|
| **Super Admin** | - Gestión completa del sistema<br>- Crear/editar todas las estructuras<br>- Cargar metas de cualquier empleado<br>- Administrar presentaciones | Administrador del sistema |
| **Manager** | - Gestionar su departamento<br>- Cargar metas de su equipo<br>- Ver reportes de su área<br>- Crear presentaciones | Gerente de departamento |
| **Employee** | - Ver sus propias metas<br>- Ver su histórico<br>- Actualizar su progreso | Miembro del equipo |
| **Viewer** | - Ver presentaciones públicas<br>- Ver dashboards (sin editar) | Espectador/Invitado |

### Implementación con Better Auth

```typescript
// Configuración de Better Auth
export const auth = betterAuth({
  database: drizzleAdapter(db),
  users: {
    model: {
      id: 'uuid',
      email: 'string',
      name: 'string',
      role: 'enum'
    }
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 1 semana
    updateAge: 60 * 60 * 24      // 1 día
  },
  callbacks: {
    session: async ({ session, user }) => {
      session.user.role = user.role
      return session
    }
  }
})
```

## 🗂️ Estructura del Proyecto

```
monthly-goals/
├── src/
│   ├── routes/                    # Rutas de TanStack Start
│   │   ├── __root.tsx             # Layout principal con auth
│   │   ├── index.tsx              # Dashboard principal
│   │   ├── login.tsx              # Página de login
│   │   ├── admin/
│   │   │   ├── index.tsx          # Panel de administración
│   │   │   ├── departments.tsx    # Gestión de departamentos
│   │   │   ├── areas.tsx          # Gestión de áreas
│   │   │   ├── teams.tsx          # Gestión de equipos
│   │   │   └── users.tsx          # Gestión de usuarios
│   │   ├── goals/
│   │   │   ├── index.tsx          # Lista de metas actuales
│   │   │   ├── history.tsx        # Histórico de metas
│   │   │   ├── configure.tsx      # Configurar metas mensuales
│   │   │   └── $id.edit.tsx       # Editar meta específica
│   │   ├── presentations/
│   │   │   ├── index.tsx          # Lista de presentaciones
│   │   │   ├── new.tsx            # Crear presentación
│   │   │   ├── $id.tsx            # Detalle de presentación
│   │   │   ├── $id.submit.tsx     # Formulario de carga de metas
│   │   │   └── $id.view.tsx       # Vista de presentación (slides)
│   │   └── api/
│   │       ├── auth/[...all].ts   # Endpoints de Better Auth
│   │       └── trpc.ts            # API endpoints (opcional)
│   ├── components/
│   │   ├── ui/                    # Componentes base
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Dialog.tsx
│   │   │   ├── Form.tsx
│   │   │   ├── Table.tsx
│   │   │   └── ...
│   │   ├── layout/
│   │   │   ├── Header.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   └── Footer.tsx
│   │   ├── goals/
│   │   │   ├── GoalCard.tsx
│   │   │   ├── GoalForm.tsx
│   │   │   ├── GoalProgress.tsx
│   │   │   └── GoalHistory.tsx
│   │   ├── presentations/
│   │   │   ├── Slide.tsx
│   │   │   ├── SlideNavigation.tsx
│   │   │   ├── SlideTransition.tsx
│   │   │   └── PresentationViewer.tsx
│   │   └── dashboard/
│   │       ├── StatsCard.tsx
│   │       ├── ProgressChart.tsx
│   │       └── TeamOverview.tsx
│   ├── lib/
│   │   ├── db/
│   │   │   ├── client.ts          # Cliente de Drizzle
│   │   │   ├── schema.ts          # Esquema de base de datos
│   │   │   └── migrations/        # Migraciones de DB
│   │   ├── auth/
│   │   │   ├── config.ts          # Configuración de Better Auth
│   │   │   ├── middleware.ts      # Middleware de autenticación
│   │   │   └── hooks.ts           # Hooks de auth
│   │   └── utils/
│   │       ├── calculations.ts    # Cálculos de porcentajes
│   │       ├── formatting.ts      # Formateo de datos
│   │       └── validations.ts     # Validaciones
│   ├── server/
│   │   ├── functions/             # Server functions de TanStack
│   │   │   ├── departments.ts
│   │   │   ├── goals.ts
│   │   │   └── presentations.ts
│   │   └── services/              # Lógica de negocio
│   │       ├── goalService.ts
│   │       ├── presentationService.ts
│   │       └── notificationService.ts
│   └── styles/
│       └── globals.css            # Estilos globales con Tailwind
├── public/                        # Assets públicos
├── drizzle.config.ts             # Configuración de Drizzle
├── .env.local                    # Variables de entorno
└── package.json
```

## 🚀 Fases de Implementación

### Fase 1: Configuración Base (2-3 días)
- [x] Configurar Drizzle ORM con Neon
- [x] Implementar esquema de base de datos
- [x] Configurar Better Auth
- [x] Setup de componentes UI base
- [x] Configurar TanStack Query (ya configurado en el proyecto)

### Fase 2: Gestión Organizacional (3-4 días)
- [x] CRUD de Departamentos
- [x] CRUD de Áreas
- [x] CRUD de Equipos
- [x] Gestión de usuarios y roles
- [x] Validación de permisos

### Fase 3: Sistema de Metas (4-5 días) ✅ COMPLETADA
- [x] Templates de metas
  - Esquema de base de datos implementado
  - Server functions con validación Zod
  - Interfaz de administración en /admin/goal-templates
  - CRUD completo con permisos de rol
- [x] Configuración mensual
  - Interfaz en /goals/configure
  - Asignación de metas por empleado y período
  - Carga masiva de metas
  - Integración con templates
- [x] Cálculo de porcentajes
  - Función calculateGoalProgress
  - Cálculo automático objetivo vs logrado
  - Retorna porcentaje, estado y color
- [x] Sistema de colores (semáforo)
  - Verde: ≥80% (successThreshold)
  - Amarillo: ≥50% (warningThreshold)
  - Rojo: <50%
  - Umbrales configurables por template
- [x] Histórico de cumplimientos
  - Función getGoalHistory
  - Vista de evolución en /goals
  - Indicadores de progreso y tendencias
  - Comparación con períodos anteriores

### Fase 4: Presentaciones (3-4 días)
- [ ] Creación de presentaciones
- [ ] Interfaz de carga para managers
- [ ] Carga masiva para admins
- [ ] Validaciones y estados

### Fase 5: Dashboard de Presentación (3-4 días)
- [ ] Sistema de slides
- [ ] Navegación y transiciones
- [ ] Visualizaciones de datos
- [ ] Modo presentación fullscreen
- [ ] Exportación (opcional)

### Fase 6: Optimización y Polish (2-3 días)
- [ ] Optimización de queries
- [ ] Mejoras de UX
- [ ] Testing
- [ ] Documentación
- [ ] Deployment

## 📈 Flujos de Usuario Principales

### 1. Flujo del Administrador
```mermaid
graph LR
    A[Login] --> B[Dashboard Admin]
    B --> C{Acción}
    C -->|Estructura| D[Gestionar Departamentos/Áreas]
    C -->|Usuarios| E[Gestionar Usuarios]
    C -->|Metas| F[Configurar Templates]
    C -->|Presentación| G[Crear Presentación]
    G --> H[Asignar Fecha]
    H --> I[Notificar Managers]
```

### 2. Flujo del Manager
```mermaid
graph LR
    A[Login] --> B[Dashboard Manager]
    B --> C[Ver Notificaciones]
    C --> D[Presentación Pendiente]
    D --> E[Cargar Metas del Equipo]
    E --> F[Revisar y Confirmar]
    F --> G[Enviar]
```

### 3. Flujo de Presentación
```mermaid
graph LR
    A[Abrir Presentación] --> B[Slide Portada]
    B --> C[Slide Departamento]
    C --> D[Slides de Empleados]
    D --> E{Más empleados?}
    E -->|Sí| D
    E -->|No| F{Más departamentos?}
    F -->|Sí| C
    F -->|No| G[Slide Resumen]
```

## 🎨 Diseño de Interfaz

### Paleta de Colores
- **Primario**: Blue-600 (#2563eb)
- **Secundario**: Gray-700 (#374151)
- **Éxito/Verde**: Green-500 (#10b981) - Meta cumplida >80%
- **Advertencia/Amarillo**: Yellow-500 (#eab308) - Meta 50-80%
- **Error/Rojo**: Red-500 (#ef4444) - Meta <50%
- **Fondo**: Gray-50 (#f9fafb)

### Componentes Clave

1. **Goal Card**
   - Nombre del empleado
   - Meta descripción
   - Barra de progreso con colores
   - Valores (logrado/objetivo)
   - Porcentaje de cumplimiento

2. **Presentation Slide**
   - Header con logo y fecha
   - Grid de 1-3 empleados por slide
   - Animaciones de entrada
   - Navegación con teclado/clicks

3. **Dashboard Stats**
   - Cards con métricas generales
   - Gráficos de tendencia
   - Rankings de cumplimiento

## 📝 Configuración de Entorno

### Variables de Entorno (.env.local)
```env
# Database
DATABASE_URL="postgresql://user:password@host/database?sslmode=require"

# Better Auth
AUTH_SECRET="your-secret-key"
AUTH_URL="http://localhost:3000"

# App Config
NEXT_PUBLIC_APP_URL="http://localhost:3000"
```

### Instalación de Dependencias
```bash
# Dependencias principales
bun add drizzle-orm @neondatabase/serverless
bun add better-auth @better-auth/react
bun add @tanstack/react-query @tanstack/react-router

# Dependencias de desarrollo
bun add -D drizzle-kit @types/node
```

## 🔄 Migraciones de Base de Datos

### Comandos de Drizzle
```bash
# Generar migraciones
bun drizzle-kit generate:pg

# Ejecutar migraciones
bun drizzle-kit push:pg

# Ver estado de migraciones
bun drizzle-kit studio
```

## 🚢 Deployment

### Opciones de Hosting
1. **Vercel**: Ideal para TanStack Start con edge functions
2. **Railway**: Soporte completo para Node.js y PostgreSQL
3. **Render**: Opción económica con auto-scaling

### Checklist de Producción
- [ ] Variables de entorno configuradas
- [ ] Base de datos migrada
- [ ] SSL/HTTPS configurado
- [ ] Backups automáticos
- [ ] Monitoring configurado
- [ ] Rate limiting implementado
- [ ] Logs centralizados

## 📊 Métricas de Éxito

### KPIs del Sistema
- Tiempo de carga de presentación < 2s
- Disponibilidad > 99.9%
- Tiempo de respuesta API < 200ms
- Satisfacción del usuario > 4/5

### Métricas de Negocio
- Reducción del tiempo de preparación de presentaciones en 80%
- Aumento en la visibilidad de metas en 100%
- Mejora en el tracking de cumplimiento
- Histórico completo de performance

## 📝 Registro de Implementación

### Fases Completadas

#### ✅ Fase 1: Configuración Base (Completada)
- Drizzle ORM configurado con Neon
- Esquema de base de datos completo
- Better Auth con roles y permisos
- Componentes UI base con shadcn/ui
- TanStack Query configurado

#### ✅ Fase 2: Gestión Organizacional (Completada)
- CRUD completo de Departamentos
- CRUD completo de Áreas
- CRUD completo de Equipos
- Gestión de usuarios y roles funcional
- Sistema de permisos implementado

#### ✅ Fase 3: Sistema de Metas (Completada)
- Templates de metas con administración completa
- Configuración mensual de metas operativa
- Cálculo de porcentajes implementado
- Sistema de semáforo funcional
- Histórico de cumplimientos disponible

### Detalles Técnicos de Implementación

#### Arquitectura Implementada
- **Server Functions**: Usando TanStack Start con `.validator()` y `.handler()`
- **Autenticación**: Better Auth con `getWebRequest()` para acceso a request
- **Base de Datos**: Drizzle ORM con PostgreSQL en Neon
- **UI Components**: shadcn/ui con fixes para React 19
- **Tipos**: TypeScript estricto sin uso de `any`
- **Estado**: TanStack Query para cache y mutations

#### Rutas Implementadas
- `/` - Dashboard principal
- `/login` - Página de autenticación
- `/admin` - Panel de administración
- `/admin/departments` - Gestión de departamentos
- `/admin/areas` - Gestión de áreas
- `/admin/teams` - Gestión de equipos
- `/admin/users` - Gestión de usuarios
- `/admin/goal-templates` - Templates de metas
- `/goals` - Vista de metas actuales e histórico
- `/goals/configure` - Configuración de metas mensuales

## 🔧 Mantenimiento y Soporte

### Tareas Recurrentes
- **Diario**: Backup de base de datos
- **Semanal**: Revisión de logs y errores
- **Mensual**: Actualización de dependencias
- **Trimestral**: Revisión de performance

### Documentación
- Manual de usuario para cada rol
- Documentación técnica de APIs
- Guía de troubleshooting
- Proceso de onboarding

## 🎯 Próximos Pasos

1. **Validar requerimientos** con stakeholders
2. **Configurar entorno de desarrollo**
3. **Comenzar con Fase 1**: Setup inicial
4. **Iteración continua** con feedback de usuarios

---

*Documento actualizado: Agosto 2025*
*Versión: 1.3.0*
*Última actualización: Fase 3 completada*
