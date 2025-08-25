import { createServerFn } from '@tanstack/start'
import { z } from 'zod'
import { db } from '../../lib/db'
import { departments, users } from '../../lib/db/schema'
import { eq } from 'drizzle-orm'
import { requireAuth, requireRole } from '../../lib/auth/middleware'

const createDepartmentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  managerId: z.string().optional(),
})

const updateDepartmentSchema = z.object({
  id: z.string().uuid(),
  data: createDepartmentSchema.partial(),
})

export const getDepartments = createServerFn({
  method: 'GET',
})
  .validator((data: unknown) => z.object({}).parse(data || {}))
  .handler(async () => {
    await requireAuth()
    
    const departmentsList = await db
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
      .orderBy(departments.name)
    
    return departmentsList
  })

export const getDepartmentById = createServerFn({
  method: 'GET',
})
  .validator((data: unknown) => z.string().uuid().parse(data))
  .handler(async ({ data: id }) => {
    await requireAuth()
    
    const department = await db
      .select()
      .from(departments)
      .where(eq(departments.id, id))
      .limit(1)
    
    if (!department[0]) {
      throw new Error('Departamento no encontrado')
    }
    
    return department[0]
  })

export const createDepartment = createServerFn({
  method: 'POST',
})
  .validator((data: unknown) => createDepartmentSchema.parse(data))
  .handler(async ({ data: validatedData }) => {
    await requireRole(['superAdmin'])
    
    const newDepartment = await db
      .insert(departments)
      .values(validatedData)
      .returning()
    
    return newDepartment[0]
  })

export const updateDepartment = createServerFn({
  method: 'POST',
})
  .validator((data: unknown) => updateDepartmentSchema.parse(data))
  .handler(async ({ data: { id, data } }) => {
    await requireRole(['superAdmin'])
    
    const updated = await db
      .update(departments)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(departments.id, id))
      .returning()
    
    if (!updated[0]) {
      throw new Error('Departamento no encontrado')
    }
    
    return updated[0]
  })

export const deleteDepartment = createServerFn({
  method: 'POST',
})
  .validator((data: unknown) => z.string().uuid().parse(data))
  .handler(async ({ data: id }) => {
    await requireRole(['superAdmin'])
    
    await db
      .delete(departments)
      .where(eq(departments.id, id))
    
    return { success: true }
  })