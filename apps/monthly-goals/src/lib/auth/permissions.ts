import { createAccessControl } from 'better-auth/plugins/access'

// Define all available permissions in the system
const statement = {
  departments: ['create', 'read', 'update', 'delete', 'manage'],
  areas: ['create', 'read', 'update', 'delete', 'manage'],
  teams: ['create', 'read', 'update', 'delete', 'manage'],
  goals: ['create', 'read', 'update', 'delete', 'submit', 'manage_all'],
  presentations: ['create', 'read', 'update', 'delete', 'view', 'submit'],
  users: ['create', 'read', 'update', 'delete', 'manage'],
  reports: ['view', 'export'],
} as const

// Create access control instance
export const ac = createAccessControl(statement)

// Define roles with their permissions
export const superAdmin = ac.newRole({
  departments: ['create', 'read', 'update', 'delete', 'manage'],
  areas: ['create', 'read', 'update', 'delete', 'manage'],
  teams: ['create', 'read', 'update', 'delete', 'manage'],
  goals: ['create', 'read', 'update', 'delete', 'submit', 'manage_all'],
  presentations: ['create', 'read', 'update', 'delete', 'view', 'submit'],
  users: ['create', 'read', 'update', 'delete', 'manage'],
  reports: ['view', 'export'],
})

export const manager = ac.newRole({
  departments: ['read', 'update'], // Can update their own department
  areas: ['create', 'read', 'update', 'delete'], // Can manage areas in their department
  teams: ['create', 'read', 'update', 'delete'], // Can manage teams in their areas
  goals: ['create', 'read', 'update', 'submit'], // Can submit goals for their team
  presentations: ['create', 'read', 'update', 'view', 'submit'],
  users: ['read'],
  reports: ['view', 'export'],
})

export const employee = ac.newRole({
  departments: ['read'],
  areas: ['read'],
  teams: ['read'],
  goals: ['read', 'update'], // Can update their own goals
  presentations: ['read', 'view'],
  users: ['read'],
  reports: ['view'],
})

export const viewer = ac.newRole({
  departments: ['read'],
  areas: ['read'],
  teams: ['read'],
  goals: ['read'],
  presentations: ['read', 'view'],
  users: ['read'],
  reports: ['view'],
})

// Export roles object for plugin configuration
export const roles = {
  superAdmin,
  manager,
  employee,
  viewer,
}