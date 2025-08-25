export interface Department {
  id: string
  name: string
  description: string | null
  managerId: string | null
  createdAt: Date
  updatedAt: Date
}

export interface DepartmentWithDetails extends Department {
  managerName: string | null
  areasCount?: number
  membersCount?: number
}

export interface CreateDepartmentInput {
  name: string
  description?: string
  managerId?: string
}

export interface UpdateDepartmentInput {
  id: string
  name?: string
  description?: string
  managerId?: string
}

export interface DeleteDepartmentInput {
  id: string
}