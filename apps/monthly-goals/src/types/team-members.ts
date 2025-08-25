export interface TeamMember {
  id: string
  userId: string
  areaId: string
  position: string | null
  joinedAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface TeamMemberWithDetails extends TeamMember {
  userName: string | null
  userEmail: string | null
  userRole: string | null
  areaName: string | null
  departmentId: string | null
  departmentName: string | null
}

export interface CreateTeamMemberInput {
  userId: string
  areaId: string
  position?: string
}

export interface UpdateTeamMemberInput {
  id: string
  position?: string
  areaId?: string
}

export interface RemoveTeamMemberInput {
  id: string
}