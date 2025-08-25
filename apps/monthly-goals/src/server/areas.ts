import { createServerFn } from '@tanstack/react-start'
import { getHeaders } from '@tanstack/react-start/server'
import { db } from '../lib/db'
import { areas, departments, teamMembers, users } from '../lib/db/schema'
import { eq, sql } from 'drizzle-orm'
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

export const getAreas = createServerFn().handler(async (): Promise<{
  id: string
  name: string
  description: string | null
  departmentId: string
  departmentName: string | null
  leadId: string | null
  leadName: string | null
  createdAt: Date
  updatedAt: Date
  membersCount: number
}[]> => {
  const result = await db
    .select({
      id: areas.id,
      name: areas.name,
      description: areas.description,
      departmentId: areas.departmentId,
      departmentName: departments.name,
      leadId: areas.leadId,
      leadName: users.name,
      createdAt: areas.createdAt,
      updatedAt: areas.updatedAt,
      membersCount: sql<number>`count(distinct ${teamMembers.id})`,
    })
    .from(areas)
    .leftJoin(departments, eq(areas.departmentId, departments.id))
    .leftJoin(users, eq(areas.leadId, users.id))
    .leftJoin(teamMembers, eq(areas.id, teamMembers.areaId))
    .groupBy(areas.id, departments.name, users.name)
  
  return result
})

export const getAreaById = createServerFn()
  .validator((input: unknown) => {
    if (typeof input !== 'object' || input === null || !('id' in input)) {
      throw new Error('Invalid input: id is required')
    }
    return input as { id: string }
  })
  .handler(async ({ data }) => {
    const result = await db
      .select({
        id: areas.id,
        name: areas.name,
        description: areas.description,
        departmentId: areas.departmentId,
        departmentName: departments.name,
        leadId: areas.leadId,
        leadName: users.name,
        createdAt: areas.createdAt,
        updatedAt: areas.updatedAt,
      })
      .from(areas)
      .leftJoin(departments, eq(areas.departmentId, departments.id))
      .leftJoin(users, eq(areas.leadId, users.id))
      .where(eq(areas.id, data.id))
      .limit(1)
    
    if (!result[0]) {
      throw new Error('Area not found')
    }
    
    const membersResult = await db
      .select({
        id: teamMembers.id,
        userId: teamMembers.userId,
        userName: users.name,
        userEmail: users.email,
        position: teamMembers.position,
        joinedAt: teamMembers.joinedAt,
      })
      .from(teamMembers)
      .leftJoin(users, eq(teamMembers.userId, users.id))
      .where(eq(teamMembers.areaId, data.id))
    
    return {
      ...result[0],
      members: membersResult,
    }
  })

export const getAreasByDepartment = createServerFn()
  .validator((input: unknown) => {
    if (typeof input !== 'object' || input === null || !('departmentId' in input)) {
      throw new Error('Invalid input: departmentId is required')
    }
    return input as { departmentId: string }
  })
  .handler(async ({ data }): Promise<{
    id: string
    name: string
    description: string | null
    departmentId: string
    departmentName: string | null
    leadId: string | null
    leadName: string | null
    createdAt: Date
    updatedAt: Date
    membersCount: number
  }[]> => {
    const result = await db
      .select({
        id: areas.id,
        name: areas.name,
        description: areas.description,
        departmentId: areas.departmentId,
        departmentName: departments.name,
        leadId: areas.leadId,
        leadName: users.name,
        createdAt: areas.createdAt,
        updatedAt: areas.updatedAt,
        membersCount: sql<number>`count(distinct ${teamMembers.id})`,
      })
      .from(areas)
      .leftJoin(departments, eq(areas.departmentId, departments.id))
      .leftJoin(users, eq(areas.leadId, users.id))
      .leftJoin(teamMembers, eq(areas.id, teamMembers.areaId))
      .where(eq(areas.departmentId, data.departmentId))
      .groupBy(areas.id, departments.name, users.name)
    
    return result
  })

export const createArea = createServerFn()
  .validator((input: unknown) => {
    if (typeof input !== 'object' || input === null || !('name' in input) || !('departmentId' in input)) {
      throw new Error('Invalid input: name and departmentId are required')
    }
    const validInput = input as {
      name: string
      description?: string
      departmentId: string
      leadId?: string
    }
    return validInput
  })
  .handler(async ({ data }) => {
    await requireRole(['superAdmin', 'manager'])
    
    const result = await db
      .insert(areas)
      .values({
        name: data.name,
        description: data.description,
        departmentId: data.departmentId,
        leadId: data.leadId,
      })
      .returning()
    
    return result[0]
  })

export const updateArea = createServerFn()
  .validator((input: unknown) => {
    if (typeof input !== 'object' || input === null || !('id' in input)) {
      throw new Error('Invalid input: id is required')
    }
    const validInput = input as {
      id: string
      name?: string
      description?: string
      leadId?: string
    }
    return validInput
  })
  .handler(async ({ data }) => {
    await requireRole(['superAdmin', 'manager'])
    
    const updateData: Partial<typeof areas.$inferInsert> = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.description !== undefined) updateData.description = data.description
    if (data.leadId !== undefined) updateData.leadId = data.leadId
    
    const result = await db
      .update(areas)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(eq(areas.id, data.id))
      .returning()
    
    if (!result[0]) {
      throw new Error('Area not found')
    }
    
    return result[0]
  })

export const deleteArea = createServerFn()
  .validator((input: unknown) => {
    if (typeof input !== 'object' || input === null || !('id' in input)) {
      throw new Error('Invalid input: id is required')
    }
    return input as { id: string }
  })
  .handler(async ({ data }) => {
    await requireRole(['superAdmin'])
    
    // Check if area has team members
    const membersCheck = await db
      .select({ count: sql<number>`count(*)` })
      .from(teamMembers)
      .where(eq(teamMembers.areaId, data.id))
    
    if (membersCheck[0]?.count && membersCheck[0].count > 0) {
      throw new Error('Cannot delete area with existing team members')
    }
    
    const result = await db
      .delete(areas)
      .where(eq(areas.id, data.id))
      .returning()
    
    if (!result[0]) {
      throw new Error('Area not found')
    }
    
    return { success: true }
  })