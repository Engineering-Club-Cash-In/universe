import { createServerFn } from '@tanstack/react-start'
import { getHeaders } from '@tanstack/react-start/server'
import { db } from '../lib/db'
import { teamMembers, users, areas, departments, monthlyGoals } from '../lib/db/schema'
import { eq, and, sql } from 'drizzle-orm'
import { auth } from '../lib/auth/config'
import { redirect } from '@tanstack/react-router'

async function requireAuth() {
  const headerEntries = getHeaders()
  // Convert TanStack Start headers to Web API Headers
  const headers = new Headers()
  for (const [key, value] of Object.entries(headerEntries)) {
    if (value) headers.append(key, value)
  }
  
  const session = await auth.api.getSession({ headers })
  if (!session?.user) {
    throw redirect({ to: '/login' })
  }
  return session
}

async function requireRole(allowedRoles: string[]) {
  const session = await requireAuth()
  const user = session.user as { role?: string }
  if (!user.role || !allowedRoles.includes(user.role)) {
    throw new Error('Forbidden: Insufficient permissions')
  }
  return session
}

export const getTeamMembers = createServerFn().handler(async () => {
  const result = await db
    .select({
      id: teamMembers.id,
      userId: teamMembers.userId,
      userName: users.name,
      userEmail: users.email,
      userRole: users.role,
      areaId: teamMembers.areaId,
      areaName: areas.name,
      departmentId: areas.departmentId,
      departmentName: departments.name,
      position: teamMembers.position,
      joinedAt: teamMembers.joinedAt,
      createdAt: teamMembers.createdAt,
      updatedAt: teamMembers.updatedAt,
    })
    .from(teamMembers)
    .leftJoin(users, eq(teamMembers.userId, users.id))
    .leftJoin(areas, eq(teamMembers.areaId, areas.id))
    .leftJoin(departments, eq(areas.departmentId, departments.id))
  
  return result
})

export const getTeamMemberById = createServerFn()
  .validator((input: unknown) => {
    if (typeof input !== 'object' || input === null || !('id' in input)) {
      throw new Error('Invalid input: id is required')
    }
    return input as { id: string }
  })
  .handler(async ({ data }) => {
    const result = await db
      .select({
        id: teamMembers.id,
        userId: teamMembers.userId,
        userName: users.name,
        userEmail: users.email,
        userRole: users.role,
        areaId: teamMembers.areaId,
        areaName: areas.name,
        departmentId: areas.departmentId,
        departmentName: departments.name,
        position: teamMembers.position,
        joinedAt: teamMembers.joinedAt,
        createdAt: teamMembers.createdAt,
        updatedAt: teamMembers.updatedAt,
      })
      .from(teamMembers)
      .leftJoin(users, eq(teamMembers.userId, users.id))
      .leftJoin(areas, eq(teamMembers.areaId, areas.id))
      .leftJoin(departments, eq(areas.departmentId, departments.id))
      .where(eq(teamMembers.id, data.id))
      .limit(1)
    
    if (!result[0]) {
      throw new Error('Team member not found')
    }
    
    // Get current month goals
    const currentDate = new Date()
    const goalsResult = await db
      .select()
      .from(monthlyGoals)
      .where(
        and(
          eq(monthlyGoals.teamMemberId, data.id),
          eq(monthlyGoals.month, currentDate.getMonth() + 1),
          eq(monthlyGoals.year, currentDate.getFullYear())
        )
      )
    
    return {
      ...result[0],
      currentMonthGoals: goalsResult,
    }
  })

export const getTeamMembersByArea = createServerFn()
  .validator((input: unknown) => {
    if (typeof input !== 'object' || input === null || !('areaId' in input)) {
      throw new Error('Invalid input: areaId is required')
    }
    return input as { areaId: string }
  })
  .handler(async ({ data }) => {
    const result = await db
      .select({
        id: teamMembers.id,
        userId: teamMembers.userId,
        userName: users.name,
        userEmail: users.email,
        userRole: users.role,
        areaId: teamMembers.areaId,
        areaName: areas.name,
        departmentId: areas.departmentId,
        departmentName: departments.name,
        position: teamMembers.position,
        joinedAt: teamMembers.joinedAt,
        createdAt: teamMembers.createdAt,
        updatedAt: teamMembers.updatedAt,
      })
      .from(teamMembers)
      .leftJoin(users, eq(teamMembers.userId, users.id))
      .leftJoin(areas, eq(teamMembers.areaId, areas.id))
      .leftJoin(departments, eq(areas.departmentId, departments.id))
      .where(eq(teamMembers.areaId, data.areaId))
    
    return result
  })

export const createTeamMember = createServerFn()
  .validator((input: unknown) => {
    if (typeof input !== 'object' || input === null || !('userId' in input) || !('areaId' in input)) {
      throw new Error('Invalid input: userId and areaId are required')
    }
    const validInput = input as {
      userId: string
      areaId: string
      position?: string
    }
    return validInput
  })
  .handler(async ({ data }) => {
    await requireRole(['superAdmin', 'manager'])
    
    // Check if user is already in this area
    const existing = await db
      .select()
      .from(teamMembers)
      .where(
        and(
          eq(teamMembers.userId, data.userId),
          eq(teamMembers.areaId, data.areaId)
        )
      )
      .limit(1)
    
    if (existing[0]) {
      throw new Error('User is already a member of this area')
    }
    
    const result = await db
      .insert(teamMembers)
      .values({
        userId: data.userId,
        areaId: data.areaId,
        position: data.position,
      })
      .returning()
    
    return result[0]
  })

export const updateTeamMember = createServerFn()
  .validator((input: unknown) => {
    if (typeof input !== 'object' || input === null || !('id' in input)) {
      throw new Error('Invalid input: id is required')
    }
    const validInput = input as {
      id: string
      position?: string
      areaId?: string
    }
    return validInput
  })
  .handler(async ({ data }) => {
    await requireRole(['superAdmin', 'manager'])
    
    const updateData: Partial<typeof teamMembers.$inferInsert> = {}
    if (data.position !== undefined) updateData.position = data.position
    if (data.areaId !== undefined) updateData.areaId = data.areaId
    
    const result = await db
      .update(teamMembers)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(eq(teamMembers.id, data.id))
      .returning()
    
    if (!result[0]) {
      throw new Error('Team member not found')
    }
    
    return result[0]
  })

export const removeTeamMember = createServerFn()
  .validator((input: unknown) => {
    if (typeof input !== 'object' || input === null || !('id' in input)) {
      throw new Error('Invalid input: id is required')
    }
    return input as { id: string }
  })
  .handler(async ({ data }) => {
    await requireRole(['superAdmin', 'manager'])
    
    // Check if member has goals
    const goalsCheck = await db
      .select({ count: sql<number>`count(*)` })
      .from(monthlyGoals)
      .where(eq(monthlyGoals.teamMemberId, data.id))
    
    if (goalsCheck[0]?.count && goalsCheck[0].count > 0) {
      throw new Error('Cannot remove team member with existing goals. Delete or reassign goals first.')
    }
    
    const result = await db
      .delete(teamMembers)
      .where(eq(teamMembers.id, data.id))
      .returning()
    
    if (!result[0]) {
      throw new Error('Team member not found')
    }
    
    return { success: true }
  })