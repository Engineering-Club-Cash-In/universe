import { pgTable, uuid, varchar, text, timestamp, integer, decimal, pgEnum, unique, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// Enums
export const userRoleEnum = pgEnum('user_role', ['super_admin', 'manager', 'employee', 'viewer'])
export const goalStatusEnum = pgEnum('goal_status', ['pending', 'in_progress', 'completed'])
export const presentationStatusEnum = pgEnum('presentation_status', ['draft', 'ready', 'presented'])

// Users table (integrada con Better Auth)
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  name: varchar('name', { length: 255 }).notNull(),
  role: userRoleEnum('role').notNull().default('employee'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Departments (Gerencias)
export const departments = pgTable('departments', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  managerId: uuid('manager_id').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Areas
export const areas = pgTable('areas', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  departmentId: uuid('department_id').notNull().references(() => departments.id),
  leadId: uuid('lead_id').references(() => users.id),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Team Members
export const teamMembers = pgTable('team_members', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id').notNull().references(() => users.id),
  areaId: uuid('area_id').notNull().references(() => areas.id),
  position: varchar('position', { length: 255 }),
  joinedAt: timestamp('joined_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Goal Templates
export const goalTemplates = pgTable('goal_templates', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  defaultTarget: decimal('default_target', { precision: 10, scale: 2 }),
  unit: varchar('unit', { length: 50 }), // 'entregas', 'ventas', 'tickets', etc.
  successThreshold: decimal('success_threshold', { precision: 5, scale: 2 }), // % para verde (ej: 80)
  warningThreshold: decimal('warning_threshold', { precision: 5, scale: 2 }), // % para amarillo (ej: 50)
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Monthly Goals
export const monthlyGoals = pgTable('monthly_goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  teamMemberId: uuid('team_member_id').notNull().references(() => teamMembers.id),
  goalTemplateId: uuid('goal_template_id').references(() => goalTemplates.id),
  month: integer('month').notNull(), // 1-12
  year: integer('year').notNull(),
  targetValue: decimal('target_value', { precision: 10, scale: 2 }).notNull(),
  achievedValue: decimal('achieved_value', { precision: 10, scale: 2 }).default('0'),
  description: text('description'),
  status: goalStatusEnum('status').notNull().default('pending'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (table) => ({
  uniqueGoalPerMonth: unique().on(table.teamMemberId, table.goalTemplateId, table.month, table.year),
  monthYearIdx: index('month_year_idx').on(table.month, table.year),
}))

// Presentations
export const presentations = pgTable('presentations', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 255 }).notNull(),
  month: integer('month').notNull(), // 1-12
  year: integer('year').notNull(),
  status: presentationStatusEnum('status').notNull().default('draft'),
  createdBy: uuid('created_by').notNull().references(() => users.id),
  presentedAt: timestamp('presented_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Goal Submissions (for presentations)
export const goalSubmissions = pgTable('goal_submissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  presentationId: uuid('presentation_id').notNull().references(() => presentations.id),
  monthlyGoalId: uuid('monthly_goal_id').notNull().references(() => monthlyGoals.id),
  submittedValue: decimal('submitted_value', { precision: 10, scale: 2 }),
  submittedBy: uuid('submitted_by').notNull().references(() => users.id),
  submittedAt: timestamp('submitted_at').notNull().defaultNow(),
  notes: text('notes'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
})

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  managedDepartments: many(departments),
  ledAreas: many(areas),
  teamMemberships: many(teamMembers),
  createdPresentations: many(presentations),
  goalSubmissions: many(goalSubmissions),
}))

export const departmentsRelations = relations(departments, ({ one, many }) => ({
  manager: one(users, {
    fields: [departments.managerId],
    references: [users.id],
  }),
  areas: many(areas),
}))

export const areasRelations = relations(areas, ({ one, many }) => ({
  department: one(departments, {
    fields: [areas.departmentId],
    references: [departments.id],
  }),
  lead: one(users, {
    fields: [areas.leadId],
    references: [users.id],
  }),
  teamMembers: many(teamMembers),
}))

export const teamMembersRelations = relations(teamMembers, ({ one, many }) => ({
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id],
  }),
  area: one(areas, {
    fields: [teamMembers.areaId],
    references: [areas.id],
  }),
  monthlyGoals: many(monthlyGoals),
}))

export const goalTemplatesRelations = relations(goalTemplates, ({ many }) => ({
  monthlyGoals: many(monthlyGoals),
}))

export const monthlyGoalsRelations = relations(monthlyGoals, ({ one, many }) => ({
  teamMember: one(teamMembers, {
    fields: [monthlyGoals.teamMemberId],
    references: [teamMembers.id],
  }),
  goalTemplate: one(goalTemplates, {
    fields: [monthlyGoals.goalTemplateId],
    references: [goalTemplates.id],
  }),
  submissions: many(goalSubmissions),
}))

export const presentationsRelations = relations(presentations, ({ one, many }) => ({
  createdBy: one(users, {
    fields: [presentations.createdBy],
    references: [users.id],
  }),
  goalSubmissions: many(goalSubmissions),
}))

export const goalSubmissionsRelations = relations(goalSubmissions, ({ one }) => ({
  presentation: one(presentations, {
    fields: [goalSubmissions.presentationId],
    references: [presentations.id],
  }),
  monthlyGoal: one(monthlyGoals, {
    fields: [goalSubmissions.monthlyGoalId],
    references: [monthlyGoals.id],
  }),
  submittedBy: one(users, {
    fields: [goalSubmissions.submittedBy],
    references: [users.id],
  }),
}))