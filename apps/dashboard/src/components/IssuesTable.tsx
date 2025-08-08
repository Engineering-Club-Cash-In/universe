import { useState, useMemo } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { 
  Search, 
  ExternalLink,
  AlertTriangle,
  CheckCircle,
  Clock,
  CircleDot,
  Bug,
  Zap,
  BookOpen
} from 'lucide-react'
import type { JiraIssue } from '@/services/jira'
import { format, parseISO } from 'date-fns'
import { es } from 'date-fns/locale'

interface IssuesTableProps {
  issues: JiraIssue[]
}

export default function IssuesTable({ issues }: IssuesTableProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [priorityFilter, setPriorityFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')

  // Obtener valores únicos para los filtros
  const statuses = useMemo(() => {
    const uniqueStatuses = new Set(issues.map(i => i.fields.status.name))
    return Array.from(uniqueStatuses)
  }, [issues])

  const priorities = useMemo(() => {
    const uniquePriorities = new Set(issues.map(i => i.fields.priority.name))
    return Array.from(uniquePriorities)
  }, [issues])

  const types = useMemo(() => {
    const uniqueTypes = new Set(issues.map(i => i.fields.issuetype.name))
    return Array.from(uniqueTypes)
  }, [issues])

  const assignees = useMemo(() => {
    const uniqueAssignees = new Set(issues.map(i => i.fields.assignee?.displayName || 'Sin asignar'))
    return Array.from(uniqueAssignees)
  }, [issues])

  // Filtrar issues
  const filteredIssues = useMemo(() => {
    return issues.filter(issue => {
      const matchesSearch = searchTerm === '' || 
        issue.key.toLowerCase().includes(searchTerm.toLowerCase()) ||
        issue.fields.summary.toLowerCase().includes(searchTerm.toLowerCase())
      
      const matchesStatus = statusFilter === 'all' || issue.fields.status.name === statusFilter
      const matchesPriority = priorityFilter === 'all' || issue.fields.priority.name === priorityFilter
      const matchesType = typeFilter === 'all' || issue.fields.issuetype.name === typeFilter
      const matchesAssignee = assigneeFilter === 'all' || 
        (issue.fields.assignee?.displayName || 'Sin asignar') === assigneeFilter

      return matchesSearch && matchesStatus && matchesPriority && matchesType && matchesAssignee
    })
  }, [issues, searchTerm, statusFilter, priorityFilter, typeFilter, assigneeFilter])

  const getStatusIcon = (status: string) => {
    const statusLower = status.toLowerCase()
    if (statusLower.includes('done') || statusLower.includes('completado')) {
      return <CheckCircle className="h-4 w-4 text-green-600" />
    }
    if (statusLower.includes('progress') || statusLower.includes('progreso')) {
      return <CircleDot className="h-4 w-4 text-blue-600" />
    }
    if (statusLower.includes('blocked') || statusLower.includes('bloqueado')) {
      return <AlertTriangle className="h-4 w-4 text-red-600" />
    }
    return <Clock className="h-4 w-4 text-gray-600" />
  }

  const getStatusVariant = (status: string): "default" | "secondary" | "destructive" | "outline" => {
    const statusLower = status.toLowerCase()
    if (statusLower.includes('done') || statusLower.includes('completado')) return 'default'
    if (statusLower.includes('progress') || statusLower.includes('progreso')) return 'secondary'
    if (statusLower.includes('blocked') || statusLower.includes('bloqueado')) return 'destructive'
    return 'outline'
  }

  const getPriorityVariant = (priority: string): "default" | "secondary" | "destructive" | "outline" => {
    const priorityLower = priority.toLowerCase()
    if (priorityLower === 'highest' || priorityLower === 'blocker') return 'destructive'
    if (priorityLower === 'high' || priorityLower === 'alta') return 'destructive'
    if (priorityLower === 'medium' || priorityLower === 'media') return 'secondary'
    return 'outline'
  }

  const getTypeIcon = (type: string) => {
    const typeLower = type.toLowerCase()
    if (typeLower.includes('bug')) return <Bug className="h-4 w-4 text-red-600" />
    if (typeLower.includes('story') || typeLower.includes('historia')) return <BookOpen className="h-4 w-4 text-blue-600" />
    if (typeLower.includes('task') || typeLower.includes('tarea')) return <CheckCircle className="h-4 w-4 text-green-600" />
    return <Zap className="h-4 w-4 text-purple-600" />
  }

  const clearFilters = () => {
    setSearchTerm('')
    setStatusFilter('all')
    setPriorityFilter('all')
    setTypeFilter('all')
    setAssigneeFilter('all')
  }

  const hasActiveFilters = searchTerm || statusFilter !== 'all' || priorityFilter !== 'all' || 
                          typeFilter !== 'all' || assigneeFilter !== 'all'

  return (
    <Card>
      <CardHeader>
        <div className="flex justify-between items-start">
          <div>
            <CardTitle>Tareas del Sprint</CardTitle>
            <CardDescription>
              {filteredIssues.length} de {issues.length} tareas mostradas
            </CardDescription>
          </div>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              Limpiar filtros
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {/* Filtros */}
        <div className="space-y-4 mb-6">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Buscar por clave o resumen..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-10"
            />
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Estado" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los estados</SelectItem>
                {statuses.map(status => (
                  <SelectItem key={status} value={status}>{status}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Prioridad" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas las prioridades</SelectItem>
                {priorities.map(priority => (
                  <SelectItem key={priority} value={priority}>{priority}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Tipo" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos los tipos</SelectItem>
                {types.map(type => (
                  <SelectItem key={type} value={type}>{type}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger>
                <SelectValue placeholder="Asignado a" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                {assignees.map(assignee => (
                  <SelectItem key={assignee} value={assignee}>{assignee}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Tabla */}
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[100px]">Clave</TableHead>
                <TableHead>Resumen</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead>Prioridad</TableHead>
                <TableHead>Asignado</TableHead>
                <TableHead className="text-center">Points</TableHead>
                <TableHead>Actualizado</TableHead>
                <TableHead className="w-[50px]"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredIssues.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                    No se encontraron tareas con los filtros aplicados
                  </TableCell>
                </TableRow>
              ) : (
                filteredIssues.map((issue) => (
                  <TableRow key={issue.id}>
                    <TableCell className="font-medium">
                      <span className="text-blue-600">{issue.key}</span>
                    </TableCell>
                    <TableCell className="max-w-[300px]">
                      <p className="truncate">{issue.fields.summary}</p>
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        {getTypeIcon(issue.fields.issuetype.name)}
                        <span className="text-sm">{issue.fields.issuetype.name}</span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getStatusVariant(issue.fields.status.name)} className="gap-1">
                        {getStatusIcon(issue.fields.status.name)}
                        {issue.fields.status.name}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={getPriorityVariant(issue.fields.priority.name)}>
                        {issue.fields.priority.name}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {issue.fields.assignee ? (
                        <div className="flex items-center gap-2">
                          <Avatar className="h-6 w-6">
                            <AvatarImage src={issue.fields.assignee.avatarUrls?.['48x48']} />
                            <AvatarFallback className="text-xs">
                              {issue.fields.assignee.displayName.split(' ').map(n => n[0]).join('')}
                            </AvatarFallback>
                          </Avatar>
                          <span className="text-sm">{issue.fields.assignee.displayName}</span>
                        </div>
                      ) : (
                        <span className="text-sm text-muted-foreground">Sin asignar</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      {issue.fields.customfield_10016 ? (
                        <Badge variant="outline">{issue.fields.customfield_10016}</Badge>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-muted-foreground">
                        {format(parseISO(issue.fields.updated), 'dd MMM', { locale: es })}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => window.open(`${import.meta.env.VITE_JIRA_BASE_URL}/browse/${issue.key}`, '_blank')}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* Resumen de filtros */}
        {filteredIssues.length > 0 && (
          <div className="mt-4 p-4 bg-muted rounded-lg">
            <h4 className="font-semibold mb-2">Resumen</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Completadas</p>
                <p className="font-medium">
                  {filteredIssues.filter(i => i.fields.status.statusCategory.key === 'done').length}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">En Progreso</p>
                <p className="font-medium">
                  {filteredIssues.filter(i => i.fields.status.statusCategory.key === 'indeterminate').length}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Por Hacer</p>
                <p className="font-medium">
                  {filteredIssues.filter(i => i.fields.status.statusCategory.key === 'new').length}
                </p>
              </div>
              <div>
                <p className="text-muted-foreground">Total Points</p>
                <p className="font-medium">
                  {filteredIssues.reduce((sum, i) => sum + (i.fields.customfield_10016 || 0), 0)}
                </p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}