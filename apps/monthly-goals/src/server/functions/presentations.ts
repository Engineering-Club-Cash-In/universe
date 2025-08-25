import { createServerFn } from '@tanstack/start'
import { z } from 'zod'
import { db } from '../../lib/db'
import { presentations, goalSubmissions, monthlyGoals, teamMembers, users, areas, departments } from '../../lib/db/schema'
import { eq, and, desc } from 'drizzle-orm'
import { requireAuth, requireRole } from '../../lib/auth/middleware'

const createPresentationSchema = z.object({
  name: z.string().min(1).max(255),
  month: z.number().int().min(1).max(12),
  year: z.number().int().min(2020),
})

const updatePresentationSchema = z.object({
  id: z.string().uuid(),
  data: z.object({
    name: z.string().min(1).max(255).optional(),
    status: z.enum(['draft', 'ready', 'presented']).optional(),
  }),
})

const submitGoalsSchema = z.object({
  presentationId: z.string().uuid(),
  goals: z.array(z.object({
    monthlyGoalId: z.string().uuid(),
    submittedValue: z.number().min(0),
    notes: z.string().optional(),
  })),
})

const bulkSubmitGoalsSchema = z.object({
  presentationId: z.string().uuid(),
  departmentId: z.string().uuid().optional(),
  areaId: z.string().uuid().optional(),
})

export const getPresentations = createServerFn({
  method: 'GET',
})
  .validator((data: unknown) => z.object({}).parse(data || {}))
  .handler(async () => {
    await requireAuth()
    
    const presentationsList = await db
      .select({
        id: presentations.id,
        name: presentations.name,
        month: presentations.month,
        year: presentations.year,
        status: presentations.status,
        createdBy: presentations.createdBy,
        createdByName: users.name,
        presentedAt: presentations.presentedAt,
        createdAt: presentations.createdAt,
        updatedAt: presentations.updatedAt,
      })
      .from(presentations)
      .leftJoin(users, eq(presentations.createdBy, users.id))
      .orderBy(desc(presentations.year), desc(presentations.month), desc(presentations.createdAt))
    
    return presentationsList
  })

export const getPresentationById = createServerFn({
  method: 'GET',
})
  .validator((data: unknown) => z.string().uuid().parse(data))
  .handler(async ({ data: id }) => {
    await requireAuth()
    
    const presentation = await db
      .select()
      .from(presentations)
      .where(eq(presentations.id, id))
      .limit(1)
    
    if (!presentation[0]) {
      throw new Error('Presentación no encontrada')
    }
    
    const submissions = await db
      .select({
        id: goalSubmissions.id,
        monthlyGoalId: goalSubmissions.monthlyGoalId,
        submittedValue: goalSubmissions.submittedValue,
        submittedBy: goalSubmissions.submittedBy,
        submittedByName: users.name,
        submittedAt: goalSubmissions.submittedAt,
        notes: goalSubmissions.notes,
        goalTarget: monthlyGoals.targetValue,
        goalDescription: monthlyGoals.description,
        teamMemberId: monthlyGoals.teamMemberId,
      })
      .from(goalSubmissions)
      .innerJoin(monthlyGoals, eq(goalSubmissions.monthlyGoalId, monthlyGoals.id))
      .leftJoin(users, eq(goalSubmissions.submittedBy, users.id))
      .where(eq(goalSubmissions.presentationId, id))
    
    return {
      ...presentation[0],
      submissions,
    }
  })

export const createPresentation = createServerFn({
  method: 'POST',
})
  .validator((data: unknown) => createPresentationSchema.parse(data))
  .handler(async ({ data: validatedData }) => {
    const session = await requireRole(['superAdmin', 'manager'])
    
    const existingPresentation = await db
      .select()
      .from(presentations)
      .where(
        and(
          eq(presentations.month, validatedData.month),
          eq(presentations.year, validatedData.year)
        )
      )
      .limit(1)
    
    if (existingPresentation[0]) {
      throw new Error('Ya existe una presentación para este mes y año')
    }
    
    const newPresentation = await db
      .insert(presentations)
      .values({
        ...validatedData,
        createdBy: session.user.id,
        status: 'draft',
      })
      .returning()
    
    return newPresentation[0]
  })

export const updatePresentation = createServerFn({
  method: 'POST',
})
  .validator((data: unknown) => updatePresentationSchema.parse(data))
  .handler(async ({ data: { id, data } }) => {
    await requireRole(['superAdmin', 'manager'])
    
    const presentation = await db
      .select()
      .from(presentations)
      .where(eq(presentations.id, id))
      .limit(1)
    
    if (!presentation[0]) {
      throw new Error('Presentación no encontrada')
    }
    
    if (presentation[0].status === 'presented' && data.status !== 'presented') {
      throw new Error('No se puede cambiar el estado de una presentación ya presentada')
    }
    
    const updateData: Record<string, unknown> = {
      ...data,
      updatedAt: new Date(),
    }
    
    if (data.status === 'presented') {
      updateData.presentedAt = new Date()
    }
    
    const updated = await db
      .update(presentations)
      .set(updateData)
      .where(eq(presentations.id, id))
      .returning()
    
    return updated[0]
  })

export const deletePresentation = createServerFn({
  method: 'POST',
})
  .validator((data: unknown) => z.string().uuid().parse(data))
  .handler(async ({ data: id }) => {
    await requireRole(['superAdmin'])
    
    const presentation = await db
      .select()
      .from(presentations)
      .where(eq(presentations.id, id))
      .limit(1)
    
    if (!presentation[0]) {
      throw new Error('Presentación no encontrada')
    }
    
    if (presentation[0].status === 'presented') {
      throw new Error('No se puede eliminar una presentación ya presentada')
    }
    
    await db.delete(goalSubmissions).where(eq(goalSubmissions.presentationId, id))
    await db.delete(presentations).where(eq(presentations.id, id))
    
    return { success: true }
  })

export const submitGoals = createServerFn({
  method: 'POST',
})
  .validator((data: unknown) => submitGoalsSchema.parse(data))
  .handler(async ({ data: validatedData }) => {
    const session = await requireAuth()
    const { presentationId, goals } = validatedData
    
    const presentation = await db
      .select()
      .from(presentations)
      .where(eq(presentations.id, presentationId))
      .limit(1)
    
    if (!presentation[0]) {
      throw new Error('Presentación no encontrada')
    }
    
    if (presentation[0].status === 'presented') {
      throw new Error('No se pueden cargar metas en una presentación ya presentada')
    }
    
    for (const goal of goals) {
      const monthlyGoal = await db
        .select()
        .from(monthlyGoals)
        .where(
          and(
            eq(monthlyGoals.id, goal.monthlyGoalId),
            eq(monthlyGoals.month, presentation[0].month),
            eq(monthlyGoals.year, presentation[0].year)
          )
        )
        .limit(1)
      
      if (!monthlyGoal[0]) {
        throw new Error(`Meta mensual no válida: ${goal.monthlyGoalId}`)
      }
      
      const existing = await db
        .select()
        .from(goalSubmissions)
        .where(
          and(
            eq(goalSubmissions.presentationId, presentationId),
            eq(goalSubmissions.monthlyGoalId, goal.monthlyGoalId)
          )
        )
        .limit(1)
      
      if (existing[0]) {
        await db
          .update(goalSubmissions)
          .set({
            submittedValue: String(goal.submittedValue),
            notes: goal.notes,
            submittedBy: session.user.id,
            submittedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(goalSubmissions.id, existing[0].id))
      } else {
        await db
          .insert(goalSubmissions)
          .values({
            presentationId,
            monthlyGoalId: goal.monthlyGoalId,
            submittedValue: String(goal.submittedValue),
            notes: goal.notes,
            submittedBy: session.user.id,
            submittedAt: new Date(),
          })
      }
      
      await db
        .update(monthlyGoals)
        .set({
          achievedValue: String(goal.submittedValue),
          status: Number(goal.submittedValue) >= Number(monthlyGoal[0].targetValue) ? 'completed' : 'in_progress',
          updatedAt: new Date(),
        })
        .where(eq(monthlyGoals.id, goal.monthlyGoalId))
    }
    
    return { success: true, count: goals.length }
  })

export const bulkSubmitGoals = createServerFn({
  method: 'POST',
})
  .validator((data: unknown) => bulkSubmitGoalsSchema.parse(data))
  .handler(async ({ data: validatedData }) => {
    const session = await requireRole(['superAdmin', 'manager'])
    const { presentationId, departmentId, areaId } = validatedData
    
    const presentation = await db
      .select()
      .from(presentations)
      .where(eq(presentations.id, presentationId))
      .limit(1)
    
    if (!presentation[0]) {
      throw new Error('Presentación no encontrada')
    }
    
    if (presentation[0].status === 'presented') {
      throw new Error('No se pueden cargar metas en una presentación ya presentada')
    }
    
    let goalsToSubmit
    
    if (areaId) {
      goalsToSubmit = await db
        .select({
          id: monthlyGoals.id,
          achievedValue: monthlyGoals.achievedValue,
          targetValue: monthlyGoals.targetValue,
          teamMemberId: monthlyGoals.teamMemberId,
        })
        .from(monthlyGoals)
        .innerJoin(teamMembers, eq(monthlyGoals.teamMemberId, teamMembers.id))
        .where(
          and(
            eq(monthlyGoals.month, presentation[0].month),
            eq(monthlyGoals.year, presentation[0].year),
            eq(teamMembers.areaId, areaId)
          )
        )
    } else if (departmentId) {
      goalsToSubmit = await db
        .select({
          id: monthlyGoals.id,
          achievedValue: monthlyGoals.achievedValue,
          targetValue: monthlyGoals.targetValue,
          teamMemberId: monthlyGoals.teamMemberId,
        })
        .from(monthlyGoals)
        .innerJoin(teamMembers, eq(monthlyGoals.teamMemberId, teamMembers.id))
        .innerJoin(areas, eq(teamMembers.areaId, areas.id))
        .where(
          and(
            eq(monthlyGoals.month, presentation[0].month),
            eq(monthlyGoals.year, presentation[0].year),
            eq(areas.departmentId, departmentId)
          )
        )
    } else {
      goalsToSubmit = await db
        .select({
          id: monthlyGoals.id,
          achievedValue: monthlyGoals.achievedValue,
          targetValue: monthlyGoals.targetValue,
          teamMemberId: monthlyGoals.teamMemberId,
        })
        .from(monthlyGoals)
        .innerJoin(teamMembers, eq(monthlyGoals.teamMemberId, teamMembers.id))
        .where(
          and(
            eq(monthlyGoals.month, presentation[0].month),
            eq(monthlyGoals.year, presentation[0].year)
          )
        )
    }
    
    let submittedCount = 0
    
    for (const goal of goalsToSubmit) {
      const existing = await db
        .select()
        .from(goalSubmissions)
        .where(
          and(
            eq(goalSubmissions.presentationId, presentationId),
            eq(goalSubmissions.monthlyGoalId, goal.id)
          )
        )
        .limit(1)
      
      const submittedValue = Number(goal.achievedValue || 0)
      
      if (existing[0]) {
        await db
          .update(goalSubmissions)
          .set({
            submittedValue: String(submittedValue),
            submittedBy: session.user.id,
            submittedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(goalSubmissions.id, existing[0].id))
      } else {
        await db
          .insert(goalSubmissions)
          .values({
            presentationId,
            monthlyGoalId: goal.id,
            submittedValue: String(submittedValue),
            submittedBy: session.user.id,
            submittedAt: new Date(),
          })
      }
      
      submittedCount++
    }
    
    return { success: true, count: submittedCount }
  })

export const getPresentationSlides = createServerFn({
  method: 'GET',
})
  .validator((data: unknown) => z.string().uuid().parse(data))
  .handler(async ({ data: presentationId }) => {
    await requireAuth()
    
    const presentation = await db
      .select()
      .from(presentations)
      .where(eq(presentations.id, presentationId))
      .limit(1)
    
    if (!presentation[0]) {
      throw new Error('Presentación no encontrada')
    }
    
    const goalsData = await db
      .select({
        departmentId: departments.id,
        departmentName: departments.name,
        areaId: areas.id,
        areaName: areas.name,
        userId: users.id,
        userName: users.name,
        userImage: users.image,
        goalId: monthlyGoals.id,
        goalDescription: monthlyGoals.description,
        targetValue: monthlyGoals.targetValue,
        achievedValue: goalSubmissions.submittedValue,
        notes: goalSubmissions.notes,
        status: monthlyGoals.status,
      })
      .from(goalSubmissions)
      .innerJoin(monthlyGoals, eq(goalSubmissions.monthlyGoalId, monthlyGoals.id))
      .innerJoin(teamMembers, eq(monthlyGoals.teamMemberId, teamMembers.id))
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .innerJoin(areas, eq(teamMembers.areaId, areas.id))
      .innerJoin(departments, eq(areas.departmentId, departments.id))
      .where(eq(goalSubmissions.presentationId, presentationId))
      .orderBy(departments.name, areas.name, users.name)
    
    const slides = []
    
    slides.push({
      type: 'cover',
      title: presentation[0].name,
      subtitle: `${getMonthName(presentation[0].month)} ${presentation[0].year}`,
      date: presentation[0].presentedAt || new Date(),
    })
    
    const groupedByDepartment = goalsData.reduce((acc, goal) => {
      if (!acc[goal.departmentId]) {
        acc[goal.departmentId] = {
          departmentName: goal.departmentName,
          areas: {},
        }
      }
      if (!acc[goal.departmentId].areas[goal.areaId]) {
        acc[goal.departmentId].areas[goal.areaId] = {
          areaName: goal.areaName,
          employees: {},
        }
      }
      if (!acc[goal.departmentId].areas[goal.areaId].employees[goal.userId]) {
        acc[goal.departmentId].areas[goal.areaId].employees[goal.userId] = {
          userName: goal.userName,
          userImage: goal.userImage,
          goals: [],
        }
      }
      const achievedNum = typeof goal.achievedValue === 'string' ? Number(goal.achievedValue) : (goal.achievedValue || 0)
      const targetNum = Number(goal.targetValue)
      acc[goal.departmentId].areas[goal.areaId].employees[goal.userId].goals.push({
        description: goal.goalDescription,
        targetValue: targetNum,
        achievedValue: achievedNum,
        percentage: targetNum ? Math.round(achievedNum / targetNum * 100) : 0,
        status: goal.status,
        notes: goal.notes,
      })
      return acc
    }, {} as Record<string, {
      departmentName: string
      areas: Record<string, {
        areaName: string
        employees: Record<string, {
          userName: string
          userImage: string | null
          goals: Array<{
            description: string | null
            targetValue: number
            achievedValue: number
            percentage: number
            status: string | null
            notes: string | null
          }>
        }>
      }>
    }>)
    
    for (const [, department] of Object.entries(groupedByDepartment)) {
      slides.push({
        type: 'department',
        departmentName: department.departmentName,
      })
      
      for (const [, area] of Object.entries(department.areas)) {
        const employees = Object.values(area.employees)
        
        for (let i = 0; i < employees.length; i += 3) {
          slides.push({
            type: 'employees',
            areaName: area.areaName,
            employees: employees.slice(i, i + 3),
          })
        }
      }
    }
    
    const totalGoals = goalsData.length
    const completedGoals = goalsData.filter(g => g.status === 'completed').length
    const averagePercentage = goalsData.reduce((sum, g) => {
      const achievedNum = typeof g.achievedValue === 'string' ? Number(g.achievedValue) : (g.achievedValue || 0)
      const targetNum = Number(g.targetValue)
      const percentage = targetNum ? achievedNum / targetNum * 100 : 0
      return sum + percentage
    }, 0) / (totalGoals || 1)
    
    slides.push({
      type: 'summary',
      totalGoals,
      completedGoals,
      averagePercentage: Math.round(averagePercentage),
      departmentCount: Object.keys(groupedByDepartment).length,
    })
    
    return {
      presentation: presentation[0],
      slides,
    }
  })

function getMonthName(month: number): string {
  const months = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'
  ]
  return months[month - 1] || ''
}