import axios from 'axios'
import { boardsService } from './boards'

export interface JiraIssue {
  id: string
  key: string
  fields: {
    summary: string
    status: {
      name: string
      statusCategory: {
        name: string
        key: string
      }
    }
    assignee?: {
      displayName: string
      avatarUrls?: {
        '48x48': string
      }
    }
    priority: {
      name: string
      iconUrl?: string
    }
    issuetype: {
      name: string
      iconUrl?: string
    }
    created: string
    updated: string
    customfield_10016?: number // Story points field - may vary per Jira instance
    timetracking?: {
      originalEstimate?: string
      remainingEstimate?: string
      timeSpent?: string
    }
    resolution?: {
      name: string
    }
    resolutiondate?: string
  }
}

export interface Sprint {
  id: number
  self: string
  state: 'active' | 'closed' | 'future'
  name: string
  startDate: string
  endDate: string
  completeDate?: string
  originBoardId: number
  goal?: string
}

export interface SprintMetrics {
  totalIssues: number
  completedIssues: number
  inProgressIssues: number
  todoIssues: number
  blockedIssues: number
  totalStoryPoints: number
  completedStoryPoints: number
  remainingStoryPoints: number
  velocity: number
  burndownData: Array<{
    date: string
    remaining: number
    ideal: number
    completed: number
  }>
  issuesByType: Record<string, number>
  issuesByPriority: Record<string, number>
  issuesByAssignee: Record<string, { total: number; completed: number }>
}

// Obtener el board ID dinámicamente
const getCurrentBoardId = (): number => {
  const currentBoard = boardsService.getCurrentBoard()
  if (currentBoard?.boardId) {
    return currentBoard.boardId
  }
  // Fallback al .env si existe
  const envBoardId = import.meta.env.VITE_JIRA_BOARD_ID
  return envBoardId ? parseInt(envBoardId) : 1
}

// Detectar si estamos en desarrollo o producción
const isDevelopment = import.meta.env.DEV

// En desarrollo usamos el proxy, en producción necesitarás un backend
const jiraAxios = axios.create({
  baseURL: isDevelopment ? '/api/jira' : import.meta.env.VITE_JIRA_BASE_URL,
  headers: isDevelopment ? {
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  } : {
    'Authorization': `Basic ${btoa(`${import.meta.env.VITE_JIRA_EMAIL}:${import.meta.env.VITE_JIRA_API_TOKEN}`)}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json'
  }
})

export const jiraService = {
  // Obtener el sprint activo
  async getCurrentSprint(boardId?: number): Promise<Sprint | null> {
    try {
      const activeBoardId = boardId || getCurrentBoardId()
      const response = await jiraAxios.get(
        `/rest/agile/1.0/board/${activeBoardId}/sprint`,
        {
          params: {
            state: 'active'
          }
        }
      )
      
      const activeSprints = response.data.values
      return activeSprints.length > 0 ? activeSprints[0] : null
    } catch (error) {
      console.error('Error fetching current sprint:', error)
      throw error
    }
  },

  // Obtener todos los sprints
  async getAllSprints(boardId?: number): Promise<Sprint[]> {
    try {
      const activeBoardId = boardId || getCurrentBoardId()
      const response = await jiraAxios.get(
        `/rest/agile/1.0/board/${activeBoardId}/sprint`
      )
      return response.data.values
    } catch (error) {
      console.error('Error fetching sprints:', error)
      throw error
    }
  },

  // Obtener issues del sprint
  async getSprintIssues(sprintId: number): Promise<JiraIssue[]> {
    try {
      const response = await jiraAxios.get(
        `/rest/agile/1.0/sprint/${sprintId}/issue`,
        {
          params: {
            maxResults: 100,
            fields: 'summary,status,assignee,priority,issuetype,created,updated,customfield_10016,timetracking,resolution,resolutiondate'
          }
        }
      )
      return response.data.issues
    } catch (error) {
      console.error('Error fetching sprint issues:', error)
      throw error
    }
  },

  // Obtener issues del backlog
  async getBacklogIssues(boardId?: number): Promise<JiraIssue[]> {
    try {
      const activeBoardId = boardId || getCurrentBoardId()
      const response = await jiraAxios.get(
        `/rest/agile/1.0/board/${activeBoardId}/backlog`,
        {
          params: {
            maxResults: 50,
            fields: 'summary,status,assignee,priority,issuetype,created,updated,customfield_10016'
          }
        }
      )
      return response.data.issues
    } catch (error) {
      console.error('Error fetching backlog issues:', error)
      throw error
    }
  },

  // Obtener velocidad del equipo (últimos 3 sprints completados)
  async getTeamVelocity(boardId?: number): Promise<number> {
    try {
      const activeBoardId = boardId || getCurrentBoardId()
      const response = await jiraAxios.get(
        `/rest/agile/1.0/board/${activeBoardId}/sprint`,
        {
          params: {
            state: 'closed'
          }
        }
      )
      
      const closedSprints = response.data.values.slice(0, 3)
      if (closedSprints.length === 0) return 0
      
      let totalPoints = 0
      for (const sprint of closedSprints) {
        const issues = await this.getSprintIssues(sprint.id)
        const sprintPoints = issues.reduce((sum, issue) => {
          const points = issue.fields.customfield_10016 || 0
          const isDone = issue.fields.status.statusCategory.key === 'done'
          return sum + (isDone ? points : 0)
        }, 0)
        totalPoints += sprintPoints
      }
      
      return Math.round(totalPoints / closedSprints.length)
    } catch (error) {
      console.error('Error calculating velocity:', error)
      return 0
    }
  },

  // Calcular métricas del sprint
  async getSprintMetrics(sprintId: number): Promise<SprintMetrics> {
    try {
      const [issues, velocity, sprint] = await Promise.all([
        this.getSprintIssues(sprintId),
        this.getTeamVelocity(),
        this.getSprintById(sprintId)
      ])
      
      // Categorizar issues por estado
      const todoIssues = issues.filter(i => 
        i.fields.status.statusCategory.key === 'new' || 
        i.fields.status.statusCategory.key === 'indeterminate'
      )
      const inProgressIssues = issues.filter(i => 
        i.fields.status.statusCategory.key === 'indeterminate' &&
        i.fields.status.name.toLowerCase().includes('progress')
      )
      const doneIssues = issues.filter(i => 
        i.fields.status.statusCategory.key === 'done'
      )
      const blockedIssues = issues.filter(i => 
        i.fields.status.name.toLowerCase().includes('blocked')
      )
      
      // Calcular story points
      const getPoints = (issue: JiraIssue) => issue.fields.customfield_10016 || 0
      const totalStoryPoints = issues.reduce((sum, i) => sum + getPoints(i), 0)
      const completedStoryPoints = doneIssues.reduce((sum, i) => sum + getPoints(i), 0)
      const remainingStoryPoints = totalStoryPoints - completedStoryPoints
      
      // Agrupar por tipo
      const issuesByType = issues.reduce((acc, issue) => {
        const type = issue.fields.issuetype.name
        acc[type] = (acc[type] || 0) + 1
        return acc
      }, {} as Record<string, number>)
      
      // Agrupar por prioridad
      const issuesByPriority = issues.reduce((acc, issue) => {
        const priority = issue.fields.priority.name
        acc[priority] = (acc[priority] || 0) + 1
        return acc
      }, {} as Record<string, number>)
      
      // Agrupar por asignado
      const issuesByAssignee = issues.reduce((acc, issue) => {
        const assignee = issue.fields.assignee?.displayName || 'Sin asignar'
        if (!acc[assignee]) {
          acc[assignee] = { total: 0, completed: 0 }
        }
        acc[assignee].total++
        if (issue.fields.status.statusCategory.key === 'done') {
          acc[assignee].completed++
        }
        return acc
      }, {} as Record<string, { total: number; completed: number }>)
      
      // Generar datos de burndown
      const burndownData = await this.generateBurndownData(sprint, issues)
      
      return {
        totalIssues: issues.length,
        completedIssues: doneIssues.length,
        inProgressIssues: inProgressIssues.length,
        todoIssues: todoIssues.length,
        blockedIssues: blockedIssues.length,
        totalStoryPoints,
        completedStoryPoints,
        remainingStoryPoints,
        velocity,
        burndownData,
        issuesByType,
        issuesByPriority,
        issuesByAssignee
      }
    } catch (error) {
      console.error('Error calculating sprint metrics:', error)
      throw error
    }
  },

  // Obtener un sprint específico
  async getSprintById(sprintId: number): Promise<Sprint> {
    try {
      const response = await jiraAxios.get(`/rest/agile/1.0/sprint/${sprintId}`)
      return response.data
    } catch (error) {
      console.error('Error fetching sprint:', error)
      throw error
    }
  },

  // Generar datos para el gráfico burndown
  async generateBurndownData(sprint: Sprint, issues: JiraIssue[]) {
    const startDate = new Date(sprint.startDate)
    const endDate = new Date(sprint.endDate)
    const today = new Date()
    
    const totalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))
    const totalPoints = issues.reduce((sum, i) => sum + (i.fields.customfield_10016 || 0), 0)
    const dailyIdeal = totalPoints / totalDays
    
    const burndownData = []
    
    // Para cada día del sprint hasta hoy
    for (let i = 0; i <= totalDays; i++) {
      const currentDate = new Date(startDate)
      currentDate.setDate(currentDate.getDate() + i)
      
      if (currentDate <= today && currentDate <= endDate) {
        // Calcular puntos completados hasta esta fecha
        const completedByDate = issues.filter(issue => {
          if (issue.fields.resolutiondate) {
            const resolutionDate = new Date(issue.fields.resolutiondate)
            return resolutionDate <= currentDate && issue.fields.status.statusCategory.key === 'done'
          }
          return false
        }).reduce((sum, i) => sum + (i.fields.customfield_10016 || 0), 0)
        
        burndownData.push({
          date: currentDate.toISOString().split('T')[0],
          remaining: totalPoints - completedByDate,
          ideal: Math.max(0, totalPoints - (dailyIdeal * i)),
          completed: completedByDate
        })
      }
    }
    
    return burndownData
  },

  // Buscar issues con JQL
  async searchIssues(jql: string): Promise<JiraIssue[]> {
    try {
      const response = await jiraAxios.get('/rest/api/2/search', {
        params: {
          jql,
          maxResults: 100,
          fields: 'summary,status,assignee,priority,issuetype,created,updated,customfield_10016'
        }
      })
      return response.data.issues
    } catch (error) {
      console.error('Error searching issues:', error)
      throw error
    }
  }
}