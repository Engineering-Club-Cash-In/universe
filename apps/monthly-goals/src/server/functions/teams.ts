import { createServerFn } from '@tanstack/start'
import { db } from '../../lib/db/client'
import { teamMembers, users, areas, departments } from '../../lib/db/schema'
import { eq, and } from 'drizzle-orm'

export const getTeamMembers = createServerFn({
  method: 'GET',
})
  .validator((params: { departmentId?: string; areaId?: string } = {}) => params)
  .handler(async ({ data: { departmentId, areaId } }) => {
    const baseQuery = db
      .select({
        id: teamMembers.id,
        userId: teamMembers.userId,
        areaId: teamMembers.areaId,
        position: teamMembers.position,
        joinedAt: teamMembers.joinedAt,
        user: {
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
        },
        area: {
          id: areas.id,
          name: areas.name,
          description: areas.description,
          departmentId: areas.departmentId,
        },
        department: {
          id: departments.id,
          name: departments.name,
          description: departments.description,
        },
      })
      .from(teamMembers)
      .innerJoin(users, eq(teamMembers.userId, users.id))
      .innerJoin(areas, eq(teamMembers.areaId, areas.id))
      .innerJoin(departments, eq(areas.departmentId, departments.id))

    const conditions = []
    if (areaId) {
      conditions.push(eq(teamMembers.areaId, areaId))
    }
    if (departmentId) {
      conditions.push(eq(areas.departmentId, departmentId))
    }

    const query = conditions.length > 0 
      ? baseQuery.where(and(...conditions))
      : baseQuery
    
    const results = await query

    return results.map(r => ({
      id: r.id,
      userId: r.userId,
      areaId: r.areaId,
      position: r.position,
      joinedAt: r.joinedAt,
      user: r.user,
      area: {
        ...r.area,
        department: r.department,
      },
    }))
  })