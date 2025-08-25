import { createServerFn } from '@tanstack/react-start'
import { getHeaders } from '@tanstack/react-start/server'
import { db } from '../lib/db'
import { departments, areas, teamMembers, users } from '../lib/db/schema'
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

export const getDepartments = createServerFn().handler(async () => {
  const result = await db
    .select({
      id: departments.id,
      name: departments.name,
      description: departments.description,
      managerId: departments.managerId,
      managerName: users.name,
      createdAt: departments.createdAt,
      updatedAt: departments.updatedAt,
      areasCount: sql<number>`count(distinct ${areas.id})`,
      membersCount: sql<number>`count(distinct ${teamMembers.id})`,
    })
    .from(departments)
    .leftJoin(users, eq(departments.managerId, users.id))
    .leftJoin(areas, eq(departments.id, areas.departmentId))
    .leftJoin(teamMembers, eq(areas.id, teamMembers.areaId))
    .groupBy(departments.id, users.name)
  
  return result
})

export const getDepartmentById = createServerFn()
  .validator((input: unknown) => {
    if (typeof input !== 'object' || input === null || !('id' in input)) {
      throw new Error('Invalid input: id is required')
    }
    return input as { id: string }
  })
  .handler(async ({ data }) => {
    const result = await db
      .select({
        id: departments.id,
        name: departments.name,
        description: departments.description,
        managerId: departments.managerId,
        managerName: users.name,
        createdAt: departments.createdAt,
        updatedAt: departments.updatedAt,
      })
      .from(departments)
      .leftJoin(users, eq(departments.managerId, users.id))
      .where(eq(departments.id, data.id))
      .limit(1)
    
    if (!result[0]) {
      throw new Error('Department not found')
    }
    
    const areasResult = await db
      .select()
      .from(areas)
      .where(eq(areas.departmentId, data.id))
    
    return {
      ...result[0],
      areas: areasResult,
    }
  })

export const createDepartment = createServerFn()
  .validator((input: unknown) => {
    if (typeof input !== 'object' || input === null || !('name' in input)) {
      throw new Error('Invalid input: name is required')
    }
    const validInput = input as {
      name: string
      description?: string
      managerId?: string
    }
    return validInput
  })
  .handler(async ({ data }) => {
    await requireRole(['superAdmin'])
    
    const result = await db
      .insert(departments)
      .values({
        name: data.name,
        description: data.description,
        managerId: data.managerId,
      })
      .returning()
    
    return result[0]
  })

export const updateDepartment = createServerFn()
  .validator((input: unknown) => {
    if (typeof input !== 'object' || input === null || !('id' in input)) {
      throw new Error('Invalid input: id is required')
    }
    const validInput = input as {
      id: string
      name?: string
      description?: string
      managerId?: string
    }
    return validInput
  })
  .handler(async ({ data }) => {
    await requireRole(['superAdmin'])
    
    const updateData: Partial<typeof departments.$inferInsert> = {}
    if (data.name !== undefined) updateData.name = data.name
    if (data.description !== undefined) updateData.description = data.description
    if (data.managerId !== undefined) updateData.managerId = data.managerId
    
    const result = await db
      .update(departments)
      .set({
        ...updateData,
        updatedAt: new Date(),
      })
      .where(eq(departments.id, data.id))
      .returning()
    
    if (!result[0]) {
      throw new Error('Department not found')
    }
    
    return result[0]
  })

export const deleteDepartment = createServerFn()
  .validator((input: unknown) => {
    if (typeof input !== 'object' || input === null || !('id' in input)) {
      throw new Error('Invalid input: id is required')
    }
    return input as { id: string }
  })
  .handler(async ({ data }) => {
    await requireRole(['superAdmin'])
    
    // Check if department has areas
    const areasCheck = await db
      .select({ count: sql<number>`count(*)` })
      .from(areas)
      .where(eq(areas.departmentId, data.id))
    
    if (areasCheck[0]?.count && areasCheck[0].count > 0) {
      throw new Error('Cannot delete department with existing areas')
    }
    
    const result = await db
      .delete(departments)
      .where(eq(departments.id, data.id))
      .returning()
    
    if (!result[0]) {
      throw new Error('Department not found')
    }
    
    return { success: true }
  })