export interface Area {
  id: string
  name: string
  description: string | null
  departmentId: string
  leadId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface AreaWithDetails extends Area {
  departmentName: string | null
  leadName: string | null
  membersCount?: number
}

export interface CreateAreaInput {
  name: string
  description?: string
  departmentId: string
  leadId?: string
}

export interface UpdateAreaInput {
  id: string
  name?: string
  description?: string
  leadId?: string
}

export interface DeleteAreaInput {
  id: string
}