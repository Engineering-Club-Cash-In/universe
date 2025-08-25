import { createServerFn } from '@tanstack/start'
import { z } from 'zod'
import { db } from '../../lib/db'
import { areas, departments, users } from '../../lib/db/schema'
import { eq } from 'drizzle-orm'
import { requireAuth, requireRole } from '../../lib/auth/middleware'

const createAreaSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  departmentId: z.string().uuid(),
  leadId: z.string().optional(),
})

const updateAreaSchema = z.object({
  id: z.string().uuid(),
  data: createAreaSchema.partial(),
})

export const getAreas = createServerFn({
  method: 'GET',
})
  .validator((data: unknown) => z.object({}).parse(data || {}))
  .handler(async () => {
    await requireAuth()
    
    const areasList = await db
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
      .orderBy(departments.name, areas.name)
    
    return areasList
  })

export const getAreaById = createServerFn({
  method: 'GET',
})
  .validator((data: unknown) => z.string().uuid().parse(data))
  .handler(async ({ data: id }) => {
    await requireAuth()
    
    const area = await db
      .select()
      .from(areas)
      .where(eq(areas.id, id))
      .limit(1)
    
    if (!area[0]) {
      throw new Error('Área no encontrada')
    }
    
    return area[0]
  })

export const createArea = createServerFn({
  method: 'POST',
})
  .validator((data: unknown) => createAreaSchema.parse(data))
  .handler(async ({ data: validatedData }) => {
    await requireRole(['superAdmin', 'manager'])
    
    const newArea = await db
      .insert(areas)
      .values(validatedData)
      .returning()
    
    return newArea[0]
  })

export const updateArea = createServerFn({
  method: 'POST',
})
  .validator((data: unknown) => updateAreaSchema.parse(data))
  .handler(async ({ data: { id, data } }) => {
    await requireRole(['superAdmin', 'manager'])
    
    const updated = await db
      .update(areas)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(areas.id, id))
      .returning()
    
    if (!updated[0]) {
      throw new Error('Área no encontrada')
    }
    
    return updated[0]
  })

export const deleteArea = createServerFn({
  method: 'POST',
})
  .validator((data: unknown) => z.string().uuid().parse(data))
  .handler(async ({ data: id }) => {
    await requireRole(['superAdmin'])
    
    await db
      .delete(areas)
      .where(eq(areas.id, id))
    
    return { success: true }
  })