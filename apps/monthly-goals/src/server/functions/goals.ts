import { createServerFn } from '@tanstack/start'
import { db } from '../../lib/db/client'
import { goalTemplates, monthlyGoals, teamMembers, users, areas, departments } from '../../lib/db/schema'
import { requireRole } from '../../lib/auth/middleware'
import { eq, and, desc, asc } from 'drizzle-orm'
import { z } from 'zod'

// Schemas de validación
const createGoalTemplateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  defaultTarget: z.number().positive().optional(),
  unit: z.string().max(50).optional(),
  successThreshold: z.number().min(0).max(100).default(80),
  warningThreshold: z.number().min(0).max(100).default(50),
})

const updateGoalTemplateSchema = createGoalTemplateSchema.partial()

const createMonthlyGoalSchema = z.object({
  teamMemberId: z.string().uuid(),
  goalTemplateId: z.string().uuid().optional(),
  month: z.number().min(1).max(12),
  year: z.number().min(2024).max(2100),
  targetValue: z.number().positive(),
  description: z.string().optional(),
})

const updateMonthlyGoalSchema = z.object({
  targetValue: z.number().positive().optional(),
  achievedValue: z.number().min(0).optional(),
  description: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'completed']).optional(),
})

// Funciones para Goal Templates
export const getGoalTemplates = createServerFn({
  method: 'GET',
}).handler(async () => {
  const templates = await db
    .select()
    .from(goalTemplates)
    .orderBy(asc(goalTemplates.name))
  
  return templates
})

export const getGoalTemplateById = createServerFn({
  method: 'GET',
})
  .validator((data: string) => data)
  .handler(async ({ data: id }) => {
    const [template] = await db
      .select()
      .from(goalTemplates)
      .where(eq(goalTemplates.id, id))
      .limit(1)
    
    return template
  })

export const createGoalTemplate = createServerFn({
  method: 'POST',
})
  .validator((data: unknown) => createGoalTemplateSchema.parse(data))
  .handler(async ({ data: validatedData }) => {
    await requireRole(['superAdmin'])
    
    const [template] = await db
      .insert(goalTemplates)
      .values({
        name: validatedData.name,
        description: validatedData.description,
        defaultTarget: validatedData.defaultTarget?.toString(),
        unit: validatedData.unit,
        successThreshold: validatedData.successThreshold.toString(),
        warningThreshold: validatedData.warningThreshold.toString(),
      })
      .returning()
    
    return template
  })

export const updateGoalTemplate = createServerFn({
  method: 'POST',
})
  .validator((input: { id: string; data: unknown }) => ({
    id: input.id,
    data: updateGoalTemplateSchema.parse(input.data)
  }))
  .handler(async ({ data: { id, data: validatedData } }) => {
    await requireRole(['superAdmin'])
    
    const updateValues: Partial<{
      name: string
      description: string
      defaultTarget: string
      unit: string
      successThreshold: string
      warningThreshold: string
      updatedAt: Date
    }> = {
      updatedAt: new Date(),
    }
    
    if (validatedData.name !== undefined) updateValues.name = validatedData.name
    if (validatedData.description !== undefined) updateValues.description = validatedData.description
    if (validatedData.unit !== undefined) updateValues.unit = validatedData.unit
    if (validatedData.defaultTarget !== undefined) {
      updateValues.defaultTarget = validatedData.defaultTarget.toString()
    }
    if (validatedData.successThreshold !== undefined) {
      updateValues.successThreshold = validatedData.successThreshold.toString()
    }
    if (validatedData.warningThreshold !== undefined) {
      updateValues.warningThreshold = validatedData.warningThreshold.toString()
    }
    
    const [template] = await db
      .update(goalTemplates)
      .set(updateValues)
      .where(eq(goalTemplates.id, id))
      .returning()
    
    return template
  })

export const deleteGoalTemplate = createServerFn({
  method: 'POST',
})
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    await requireRole(['superAdmin'])
    
    await db
      .delete(goalTemplates)
      .where(eq(goalTemplates.id, id))
    
    return { success: true }
  })

// Funciones para Monthly Goals
export const getMonthlyGoals = createServerFn({
  method: 'GET',
})
  .validator((params: { month?: number; year?: number; teamMemberId?: string }) => params)
  .handler(async ({ data: { month, year, teamMemberId } }) => {
    const baseQuery = db
      .select({
        goal: monthlyGoals,
        template: goalTemplates,
        member: teamMembers,
        user: users,
        area: areas,
        department: departments,
      })
      .from(monthlyGoals)
      .leftJoin(goalTemplates, eq(monthlyGoals.goalTemplateId, goalTemplates.id))
      .innerJoin(teamMembers, eq(monthlyGoals.teamMemberId, teamMembers.id))
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .innerJoin(areas, eq(teamMembers.areaId, areas.id))
      .innerJoin(departments, eq(areas.departmentId, departments.id))
    
    const conditions = []
    if (month) conditions.push(eq(monthlyGoals.month, month))
    if (year) conditions.push(eq(monthlyGoals.year, year))
    if (teamMemberId) conditions.push(eq(monthlyGoals.teamMemberId, teamMemberId))
    
    const query = conditions.length > 0 
      ? baseQuery.where(and(...conditions))
      : baseQuery
    
    const results = await query.orderBy(
      desc(monthlyGoals.year),
      desc(monthlyGoals.month),
      asc(users.name)
    )
    
    return results.map(r => ({
      ...r.goal,
      template: r.template,
      teamMember: {
        ...r.member,
        user: r.user,
        area: {
          ...r.area,
          department: r.department,
        },
      },
    }))
  })

export const createMonthlyGoal = createServerFn({
  method: 'POST',
})
  .validator((data: unknown) => createMonthlyGoalSchema.parse(data))
  .handler(async ({ data: validatedData }) => {
    await requireRole(['superAdmin', 'manager'])
    
    const [goal] = await db
      .insert(monthlyGoals)
      .values({
        teamMemberId: validatedData.teamMemberId,
        goalTemplateId: validatedData.goalTemplateId,
        month: validatedData.month,
        year: validatedData.year,
        targetValue: validatedData.targetValue.toString(),
        description: validatedData.description,
        status: 'pending',
      })
      .returning()
    
    return goal
  })

export const updateMonthlyGoal = createServerFn({
  method: 'POST',
})
  .validator((input: { id: string; data: unknown }) => ({
    id: input.id,
    data: updateMonthlyGoalSchema.parse(input.data)
  }))
  .handler(async ({ data: { id, data: validatedData } }) => {
    await requireRole(['superAdmin', 'manager'])
    
    const updateValues: Partial<{
      targetValue: string
      achievedValue: string
      description: string
      status: 'pending' | 'in_progress' | 'completed'
      updatedAt: Date
    }> = {
      updatedAt: new Date(),
    }
    
    if (validatedData.targetValue !== undefined) {
      updateValues.targetValue = validatedData.targetValue.toString()
    }
    if (validatedData.achievedValue !== undefined) {
      updateValues.achievedValue = validatedData.achievedValue.toString()
    }
    if (validatedData.description !== undefined) {
      updateValues.description = validatedData.description
    }
    if (validatedData.status !== undefined) {
      updateValues.status = validatedData.status
    }
    
    const [goal] = await db
      .update(monthlyGoals)
      .set(updateValues)
      .where(eq(monthlyGoals.id, id))
      .returning()
    
    return goal
  })

export const deleteMonthlyGoal = createServerFn({
  method: 'POST',
})
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    await requireRole(['superAdmin'])
    
    await db
      .delete(monthlyGoals)
      .where(eq(monthlyGoals.id, id))
    
    return { success: true }
  })

// Función para calcular porcentajes y obtener color del semáforo
export const calculateGoalProgress = (
  achievedValue: number,
  targetValue: number,
  successThreshold: number = 80,
  warningThreshold: number = 50
) => {
  const percentage = (achievedValue / targetValue) * 100
  
  let status: 'success' | 'warning' | 'danger'
  if (percentage >= successThreshold) {
    status = 'success'
  } else if (percentage >= warningThreshold) {
    status = 'warning'
  } else {
    status = 'danger'
  }
  
  return {
    percentage: Math.round(percentage * 100) / 100,
    status,
    color: status === 'success' ? 'green' : status === 'warning' ? 'yellow' : 'red',
  }
}

// Función para obtener histórico de cumplimiento
export const getGoalHistory = createServerFn({
  method: 'GET',
})
  .validator((params: { teamMemberId: string; limit?: number }) => params)
  .handler(async ({ data: { teamMemberId, limit = 12 } }) => {
    const goals = await db
      .select({
        month: monthlyGoals.month,
        year: monthlyGoals.year,
        targetValue: monthlyGoals.targetValue,
        achievedValue: monthlyGoals.achievedValue,
        status: monthlyGoals.status,
        templateName: goalTemplates.name,
        unit: goalTemplates.unit,
        successThreshold: goalTemplates.successThreshold,
        warningThreshold: goalTemplates.warningThreshold,
      })
      .from(monthlyGoals)
      .leftJoin(goalTemplates, eq(monthlyGoals.goalTemplateId, goalTemplates.id))
      .where(eq(monthlyGoals.teamMemberId, teamMemberId))
      .orderBy(desc(monthlyGoals.year), desc(monthlyGoals.month))
      .limit(limit)
    
    return goals.map(goal => {
      const achieved = parseFloat(goal.achievedValue || '0')
      const target = parseFloat(goal.targetValue || '1')
      const successThreshold = parseFloat(goal.successThreshold || '80')
      const warningThreshold = parseFloat(goal.warningThreshold || '50')
      
      const progress = calculateGoalProgress(achieved, target, successThreshold, warningThreshold)
      
      return {
        ...goal,
        ...progress,
      }
    })
  })

// Función para carga masiva de metas mensuales
interface BulkGoalInput {
  teamMemberId: string
  goalTemplateId: string
  targetValue: number
  description?: string
}

export const bulkCreateMonthlyGoals = createServerFn({
  method: 'POST',
})
  .validator((input: { 
    month: number
    year: number
    goals: BulkGoalInput[]
  }) => input)
  .handler(async ({ data: { month, year, goals } }) => {
    await requireRole(['superAdmin'])
    
    const validatedGoals = goals.map(goal => ({
      teamMemberId: goal.teamMemberId,
      goalTemplateId: goal.goalTemplateId,
      month,
      year,
      targetValue: goal.targetValue.toString(),
      description: goal.description,
      status: 'pending' as const,
    }))
    
    const createdGoals = await db
      .insert(monthlyGoals)
      .values(validatedGoals)
      .returning()
    
    return createdGoals
  })