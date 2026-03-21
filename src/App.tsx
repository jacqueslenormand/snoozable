import { useState, useEffect, useRef } from "react"
import * as z from "zod"
import { isTaskDueOnDay, dayOfDate, getNextScheduledDayNumber, formatNextScheduledDay } from "./taskUtils"
import "./App.css"

const locationSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().default(""),
})

type Location = z.infer<typeof locationSchema>

const taskSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  locationIds: z.array(z.string()),
  schedule: z.union([
    z.object({
      // most common type
      t: z.literal("interval"),
      intervalInDays: z.number(),
    }),
    z.object({
      // second most common type
      t: z.literal("monthly"),
      dayOfMonth: z.number().min(0).max(28),
    }),
    z.object({
      // least common type
      t: z.literal("weekly"),
      daysOfWeek: z.array(z.number().min(0).max(6)), // 0 is sunday
    }),
  ]),
})

type Task = z.infer<typeof taskSchema>

const stateSchema = z.object({
  locations: z.array(locationSchema),
  tasks: z.array(taskSchema),
  mostRecentTaskCompletions: z.record(z.string(), z.number()),
  snoozedTasks: z.record(z.string(), z.number()).optional().default({}),
  taskOrder: z.array(z.string()).optional().default([]),
})

type State = z.infer<typeof stateSchema>

const createLocation = (name: string, description: string = ""): Location => {
  return {
    id: crypto.randomUUID(),
    name,
    description,
  }
}

const initialState: State = {
  locations: [],
  tasks: [],
  mostRecentTaskCompletions: {},
  snoozedTasks: {},
  taskOrder: [],
}

const addLocation = (state: State, location: Location): State => {
  return {
    ...state,
    locations: [...state.locations, location],
  }
}

const addTaskCompletion = (state: State, taskId: string, asof: Date): State => {
  const snoozedTasks = { ...state.snoozedTasks }
  delete snoozedTasks[taskId]
  return {
    ...state,
    mostRecentTaskCompletions: { ...state.mostRecentTaskCompletions, [taskId]: asof.getTime() },
    snoozedTasks,
  }
}

const snoozeTask = (state: State, taskId: string, asof: Date): State => {
  return {
    ...state,
    snoozedTasks: { ...state.snoozedTasks, [taskId]: asof.getTime() },
  }
}

const deleteTask = (state: State, taskId: string): State => {
  return {
    ...state,
    tasks: state.tasks.filter((t) => t.id !== taskId),
    mostRecentTaskCompletions: Object.fromEntries(
      Object.entries(state.mostRecentTaskCompletions).filter(([k]) => k !== taskId),
    ),
    snoozedTasks: Object.fromEntries(
      Object.entries(state.snoozedTasks).filter(([k]) => k !== taskId),
    ),
  }
}

const deleteLocation = (state: State, locationId: string): State => {
  return {
    ...state,
    locations: state.locations.filter((l) => l.id !== locationId),
    tasks: state.tasks.map((t) => ({
      ...t,
      locationIds: t.locationIds.filter((id) => id !== locationId),
    })),
  }
}

type ActionType =
  | "Add location"
  | "Add task"
  | "Complete task"
  | "Snooze task"
  | "Delete task"
  | "Delete location"
  | "Edit task"

const createTaskWithSchedule = (
  name: string,
  description: string,
  locationIds: string[],
  schedule: Task["schedule"],
): Task => {
  return {
    id: crypto.randomUUID(),
    name,
    description,
    locationIds,
    schedule,
  }
}

function setIntersection<T>(a: Set<T>, b: Set<T>): Set<T> {
  const intersection = new Set<T>()
  for (const item of a) {
    if (b.has(item)) {
      intersection.add(item)
    }
  }
  return intersection
}

const getTasksDueAtLocations = (state: State, locationIds: string[], asof: Date): Task[] => {
  const tasksAtLocations = state.tasks.filter(
    (task) =>
      locationIds.length === 0 ||
      setIntersection(new Set(locationIds), new Set(task.locationIds)).size > 0,
  )

  const dayOfDateValue = dayOfDate(asof)
  const tasksDue: Task[] = []

  for (const task of tasksAtLocations) {
    const lastCompleted = state.mostRecentTaskCompletions[task.id]
    const lastSnoozedDay = state.snoozedTasks[task.id]
      ? dayOfDate(new Date(state.snoozedTasks[task.id]))
      : undefined

    const asofIsToday = dayOfDateValue === dayOfDate(new Date())
    if (isTaskDueOnDay(task, dayOfDateValue, lastCompleted, lastSnoozedDay, asof, asofIsToday)) {
      tasksDue.push(task)
    }
  }

  // Sort: snoozed tasks first (older first), then by completion status
  tasksDue.sort((a, b) => {
    const aSnoozed = state.snoozedTasks[a.id]
    const bSnoozed = state.snoozedTasks[b.id]
    const aCompleted = state.mostRecentTaskCompletions[a.id]
    const bCompleted = state.mostRecentTaskCompletions[b.id]

    // Both snoozed: older first
    if (aSnoozed && bSnoozed) {
      return aSnoozed - bSnoozed
    }
    // Only a snoozed: a comes first
    if (aSnoozed) return -1
    // Only b snoozed: b comes first
    if (bSnoozed) return 1
    // Neither snoozed: never completed first
    if (!aCompleted && !bCompleted) return 0
    if (!aCompleted) return -1
    if (!bCompleted) return 1
    return aCompleted - bCompleted
  })

  return tasksDue
}

function getStateFromLocalStorage(): State | null {
  const state = localStorage.getItem("__workout_state")
  if (!state) return null
  try {
    const candidate = JSON.parse(state)
    const zodParsed = stateSchema.safeParse(candidate)

    if (!zodParsed.success) {
      return null
    }

    return zodParsed.data
  } catch {
    return null
  }
}

const TASK_ORDER_KEY = "__workout_today_order"

function getTodayString(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
}

function loadTodayTaskOrder(): string[] | null {
  try {
    const raw = localStorage.getItem(TASK_ORDER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { date?: string; order?: unknown }
    if (parsed.date !== getTodayString()) {
      localStorage.removeItem(TASK_ORDER_KEY)
      return null
    }
    return Array.isArray(parsed.order) ? (parsed.order as string[]) : null
  } catch {
    localStorage.removeItem(TASK_ORDER_KEY)
    return null
  }
}

function saveTodayTaskOrder(order: string[]): void {
  localStorage.setItem(TASK_ORDER_KEY, JSON.stringify({ date: getTodayString(), order }))
}

function DraggableDiv({
  children,
  onDragged,
  onSwipeLeft,
  disabled = false,
  swipeLeftDisabled = false,
  onClick,
  className,
}: {
  children: React.ReactNode
  onDragged: (event: React.TouchEvent<HTMLDivElement>) => void
  onSwipeLeft: (event: React.TouchEvent<HTMLDivElement>) => void
  disabled?: boolean
  swipeLeftDisabled?: boolean
  onClick?: () => void
  className?: string
}) {
  const [state, setStatus] = useState<
    | { t: "idle" }
    | { t: "tracking"; startX: number; startY: number }
    | { t: "dragging"; startX: number }
  >({ t: "idle" })
  const [dragDelta, setDragDelta] = useState(0)

  return (
    <div
      className={`task-card ${state.t === "dragging" && !disabled ? "dragging" : ""} ${className ?? ""}`}
      onTouchStart={(ev) => {
        if (!disabled) {
          const touch = ev.touches[0]
          setStatus({ t: "tracking", startX: touch.clientX, startY: touch.clientY })
          setDragDelta(0)
        }
      }}
      onTouchMove={(ev) => {
        if (disabled) return
        const touch = ev.touches[0]
        if (!touch) return

        if (state.t === "tracking") {
          const deltaX = touch.clientX - state.startX
          const deltaY = touch.clientY - state.startY
          // Wait until there's enough movement to determine direction
          if (Math.abs(deltaX) < 5 && Math.abs(deltaY) < 5) return
          if (Math.abs(deltaX) > Math.abs(deltaY)) {
            // Horizontal gesture — take over from browser scroll
            setStatus({ t: "dragging", startX: state.startX })
            setDragDelta(deltaX)
          } else {
            // Vertical gesture — reset so we don't interfere with scroll
            setStatus({ t: "idle" })
          }
        } else if (state.t === "dragging") {
          setDragDelta(touch.clientX - state.startX)
        }
      }}
      onTouchEnd={(ev) => {
        if (state.t === "dragging" && !disabled) {
          const deltaX = dragDelta
          if (deltaX > 30) {
            onDragged(ev as any)
          }
          if (deltaX < -30 && !swipeLeftDisabled) {
            onSwipeLeft(ev as any)
          }
        } else if ((state.t === "tracking" || state.t === "dragging") && dragDelta === 0 && onClick) {
          // If not dragging much and click handler exists, treat as click
          onClick()
        }
        setStatus({ t: "idle" })
        setDragDelta(0)
      }}
      onClick={() => {
        if (state.t === "idle" && onClick) {
          onClick()
        }
      }}
      style={{
        transform: dragDelta !== 0 ? `translateX(${dragDelta * 0.3}px)` : undefined,
        background: state.t === "dragging" ? "black" : undefined,
        userSelect: "none",
        touchAction: "pan-y",
      }}
    >
      {state.t === "dragging" && !disabled && (
        <div className="task-card-hint">
          {!swipeLeftDisabled && <span className="task-card-hint-left">← Snooze</span>}
          <span className="task-card-hint-right">Complete →</span>
        </div>
      )}
      {children}
    </div>
  )
}

function TaskFormModal({
  isOpen,
  onClose,
  onSubmit,
  state,
}: {
  isOpen: boolean
  onClose: () => void
  onSubmit: (task: Task) => void
  state: State
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [selectedLocations, setSelectedLocations] = useState<string[]>([])
  const [scheduleType, setScheduleType] = useState<"interval" | "weekly" | "monthly">("interval")
  const [intervalDays, setIntervalDays] = useState("1")
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>([])
  const [dayOfMonth, setDayOfMonth] = useState("1")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      alert("Please enter a task name")
      return
    }

    let schedule: Task["schedule"]
    if (scheduleType === "interval") {
      schedule = {
        t: "interval",
        intervalInDays: parseInt(intervalDays) || 1,
      }
    } else if (scheduleType === "weekly") {
      if (daysOfWeek.length === 0) {
        alert("Please select at least one day of the week")
        return
      }
      schedule = {
        t: "weekly",
        daysOfWeek: daysOfWeek.sort(),
      }
    } else {
      schedule = {
        t: "monthly",
        dayOfMonth: Math.min(28, Math.max(1, parseInt(dayOfMonth) || 1)),
      }
    }

    const task = createTaskWithSchedule(name, description, selectedLocations, schedule)
    onSubmit(task)

    setName("")
    setDescription("")
    setSelectedLocations([])
    setScheduleType("interval")
    setIntervalDays("1")
    setDaysOfWeek([])
    setDayOfMonth("1")
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>➕ New Task</h2>
          <button className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Task Name *</label>
            <input
              type="text"
              placeholder="e.g., Go to gym"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              placeholder="e.g., 30 min cardio"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          {state.locations.length > 0 && (
            <div className="form-group">
              <label>📍 Locations</label>
              <div className="location-selector">
                {state.locations.map((location) => (
                  <button
                    key={location.id}
                    type="button"
                    className={`location-option ${selectedLocations.includes(location.id) ? "selected" : ""}`}
                    onClick={() => {
                      if (selectedLocations.includes(location.id)) {
                        setSelectedLocations((prev) => prev.filter((id) => id !== location.id))
                      } else {
                        setSelectedLocations((prev) => [...prev, location.id])
                      }
                    }}
                  >
                    {location.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="form-group">
            <label>🔄 Schedule</label>
            <div className="schedule-options">
              <button
                type="button"
                className={`schedule-option ${scheduleType === "interval" ? "active" : ""}`}
                onClick={() => setScheduleType("interval")}
              >
                Interval
              </button>
              <button
                type="button"
                className={`schedule-option ${scheduleType === "weekly" ? "active" : ""}`}
                onClick={() => setScheduleType("weekly")}
              >
                Weekly
              </button>
              <button
                type="button"
                className={`schedule-option ${scheduleType === "monthly" ? "active" : ""}`}
                onClick={() => setScheduleType("monthly")}
              >
                Monthly
              </button>
            </div>

            <div className="schedule-details">
              {scheduleType === "interval" && (
                <div className="form-group">
                  <label>Interval between (days)</label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={intervalDays}
                    onChange={(e) => setIntervalDays(e.target.value)}
                  />
                </div>
              )}

              {scheduleType === "weekly" && (
                <div className="form-group">
                  <label>Days of the week</label>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-around",
                      gap: "8px",
                      padding: "12px",
                      background: "white",
                    }}
                  >
                    {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day, idx) => (
                      <label
                        key={idx}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: "4px",
                          flex: 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={daysOfWeek.includes(idx)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setDaysOfWeek((prev) => [...prev, idx])
                            } else {
                              setDaysOfWeek((prev) => prev.filter((d) => d !== idx))
                            }
                          }}
                        />
                        <span style={{ fontSize: "12px", color: "#666" }}>{day}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {scheduleType === "monthly" && (
                <div className="form-group">
                  <label>Day of the month (1-28)</label>
                  <input
                    type="number"
                    min="1"
                    max="28"
                    value={dayOfMonth}
                    onChange={(e) => setDayOfMonth(e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Create Task
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function LocationFormModal({
  isOpen,
  onClose,
  onSubmit,
}: {
  isOpen: boolean
  onClose: () => void
  onSubmit: (location: Location) => void
}) {
  const [name, setName] = useState("")
  const [description, setDescription] = useState("")

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    if (!name.trim()) {
      alert("Please enter a location name")
      return
    }

    const location = createLocation(name, description)
    onSubmit(location)

    setName("")
    setDescription("")
    onClose()
  }

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>➕ New Location</h2>
          <button className="modal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Location Name *</label>
            <input
              type="text"
              placeholder="e.g., Apartment, Gym, Workplace"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              placeholder="Add notes about this location..."
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Create Location
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function TaskDetailModal({
  isOpen,
  onClose,
  task,
  taskId,
  state,
  onEdit,
}: {
  isOpen: boolean
  onClose: () => void
  task: Task | null
  taskId: string | null
  state: State
  onEdit: (taskId: string) => void
}) {
  if (!task) return null

  const getScheduleText = () => {
    if (task.schedule.t === "interval") {
      return `Every ${task.schedule.intervalInDays === 1 ? "day" : `${task.schedule.intervalInDays} days`}`
    }
    if (task.schedule.t === "weekly") {
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
      const dayNames = task.schedule.daysOfWeek.map((d) => days[d]).join(", ")
      return `Weekly on ${dayNames}`
    }
    if (task.schedule.t === "monthly") {
      return `Monthly on day ${task.schedule.dayOfMonth}`
    }
    return ""
  }

  return (
    <div className={`modal-overlay ${isOpen ? "open" : ""}`} onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>{task.name}</h2>

        {task.description && (
          <div style={{ marginBottom: "16px" }}>
            <h4 style={{ margin: "0 0 8px 0" }}>Description</h4>
            <p style={{ margin: 0, color: "#666" }}>{task.description}</p>
          </div>
        )}

        <div style={{ marginBottom: "16px" }}>
          <h4 style={{ margin: "0 0 8px 0" }}>Schedule</h4>
          <p style={{ margin: 0, color: "#666" }}>{getScheduleText()}</p>
        </div>

        {task.locationIds.length > 0 && (
          <div style={{ marginBottom: "16px" }}>
            <h4 style={{ margin: "0 0 8px 0" }}>Locations</h4>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
              {task.locationIds.map((locId) => {
                const location = state.locations.find((l) => l.id === locId)
                return location ? (
                  <span key={locId} className="task-location-badge" style={{ padding: "4px 8px" }}>
                    {location.name}
                  </span>
                ) : null
              })}
            </div>
          </div>
        )}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
           <button
             type="button"
             className="btn btn-primary"
             onClick={() => {
               if (taskId) {
                 onEdit(taskId)
                 onClose()
               }
             }}
           >
             Edit Task
           </button>
        </div>
      </div>
    </div>
  )
}

function TaskEditModal({
  isOpen,
  onClose,
  task,
  state,
  onSubmit,
}: {
  isOpen: boolean
  onClose: () => void
  task: Task | null
  state: State
  onSubmit: (updatedTask: Task) => void
}) {
  const [name, setName] = useState(task?.name || "")
  const [description, setDescription] = useState(task?.description || "")
  const [selectedLocations, setSelectedLocations] = useState<string[]>(task?.locationIds || [])
  const [scheduleType, setScheduleType] = useState<"interval" | "weekly" | "monthly">(
    task?.schedule.t ?? "interval",
  )
  const [intervalDays, setIntervalDays] = useState(
    task?.schedule.t === "interval" ? String(task.schedule.intervalInDays) : "1",
  )
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(
    task?.schedule.t === "weekly" ? task.schedule.daysOfWeek : [],
  )
  const [dayOfMonth, setDayOfMonth] = useState(
    task?.schedule.t === "monthly" ? String(task.schedule.dayOfMonth) : "1",
  )

  // Update state when task prop changes
  useEffect(() => {
    if (task) {
      setName(task.name)
      setDescription(task.description)
      setSelectedLocations(task.locationIds)
      setScheduleType(task.schedule.t)
      setIntervalDays(task.schedule.t === "interval" ? String(task.schedule.intervalInDays) : "1")
      setDaysOfWeek(task.schedule.t === "weekly" ? task.schedule.daysOfWeek : [])
      setDayOfMonth(task.schedule.t === "monthly" ? String(task.schedule.dayOfMonth) : "1")
    }
  }, [task])

  if (!task) return null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()

    let schedule: Task["schedule"]
    if (scheduleType === "interval") {
      schedule = { t: "interval", intervalInDays: parseInt(intervalDays) || 1 }
    } else if (scheduleType === "weekly") {
      if (daysOfWeek.length === 0) {
        alert("Please select at least one day of the week")
        return
      }
      schedule = { t: "weekly", daysOfWeek: daysOfWeek.sort() }
    } else {
      schedule = { t: "monthly", dayOfMonth: Math.min(28, Math.max(1, parseInt(dayOfMonth) || 1)) }
    }

    onSubmit({ ...task, name, description, locationIds: selectedLocations, schedule })
    onClose()
  }

  return (
    <div className={`modal-overlay ${isOpen ? "open" : ""}`} onClick={onClose} style={{ zIndex: isOpen ? 1000 : -1 }}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Edit Task</h2>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="task-name-edit">Task Name</label>
            <input
              id="task-name-edit"
              type="text"
              className="form-control"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter task name"
              required
            />
          </div>

          <div className="form-group">
            <label htmlFor="task-desc-edit">Description</label>
            <textarea
              id="task-desc-edit"
              className="form-control"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter task description (optional)"
              rows={3}
            />
          </div>

          <div className="form-group">
            <label>Locations</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
              {state.locations.map((location) => (
                <label
                  key={location.id}
                  style={{ display: "flex", alignItems: "center", gap: "6px", cursor: "pointer" }}
                >
                  <input
                    type="checkbox"
                    checked={selectedLocations.includes(location.id)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedLocations((prev) => [...prev, location.id])
                      } else {
                        setSelectedLocations((prev) => prev.filter((id) => id !== location.id))
                      }
                    }}
                  />
                  {location.name}
                </label>
              ))}
            </div>
          </div>

          <div className="form-group">
            <label>🔄 Schedule</label>
            <div className="schedule-options">
              <button
                type="button"
                className={`schedule-option ${scheduleType === "interval" ? "active" : ""}`}
                onClick={() => setScheduleType("interval")}
              >
                Interval
              </button>
              <button
                type="button"
                className={`schedule-option ${scheduleType === "weekly" ? "active" : ""}`}
                onClick={() => setScheduleType("weekly")}
              >
                Weekly
              </button>
              <button
                type="button"
                className={`schedule-option ${scheduleType === "monthly" ? "active" : ""}`}
                onClick={() => setScheduleType("monthly")}
              >
                Monthly
              </button>
            </div>

            <div className="schedule-details">
              {scheduleType === "interval" && (
                <div className="form-group">
                  <label>Interval between (days)</label>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    value={intervalDays}
                    onChange={(e) => setIntervalDays(e.target.value)}
                  />
                </div>
              )}

              {scheduleType === "weekly" && (
                <div className="form-group">
                  <label>Days of the week</label>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-around",
                      gap: "8px",
                      padding: "12px",
                      background: "white",
                    }}
                  >
                    {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((day, idx) => (
                      <label
                        key={idx}
                        style={{
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: "4px",
                          flex: 1,
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={daysOfWeek.includes(idx)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setDaysOfWeek((prev) => [...prev, idx])
                            } else {
                              setDaysOfWeek((prev) => prev.filter((d) => d !== idx))
                            }
                          }}
                        />
                        <span style={{ fontSize: "12px", color: "#666" }}>{day}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {scheduleType === "monthly" && (
                <div className="form-group">
                  <label>Day of the month (1-28)</label>
                  <input
                    type="number"
                    min="1"
                    max="28"
                    value={dayOfMonth}
                    onChange={(e) => setDayOfMonth(e.target.value)}
                  />
                </div>
              )}
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function HomeView({
  state,
  setState,
  onUndo,
  canUndo,
}: {
  state: State
  setState: (s: State, action?: ActionType) => void
  onUndo: () => void
  canUndo: boolean
}) {
  const [locationsIdsSelected, setLocationIdsSelected] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)
  const [localOrder, setLocalOrder] = useState<string[]>(() => loadTodayTaskOrder() ?? [])
  const [dragState, setDragState] = useState<{
    draggedId: string
    startY: number
    deltaY: number
    insertIndex: number
    originalIndex: number
    cardHeight: number
  } | null>(null)
  const dragStateRef = useRef(dragState)
  dragStateRef.current = dragState
  const taskListRef = useRef<HTMLDivElement>(null)

  const tasksAtLocation = getTasksDueAtLocations(state, locationsIdsSelected, selectedDate)

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const selectedDateAtMidnight = new Date(selectedDate)
  selectedDateAtMidnight.setHours(0, 0, 0, 0)
  const isToday = selectedDate.toDateString() === today.toDateString()
  const isPast = selectedDateAtMidnight < today

  // Apply saved order for today; new tasks (not in order) append at the end
  const orderedTasks = (() => {
    if (!isToday || localOrder.length === 0) return tasksAtLocation
    const orderMap = new Map(localOrder.map((id, i) => [id, i]))
    return [...tasksAtLocation].sort((a, b) => {
      const aIdx = orderMap.get(a.id) ?? Infinity
      const bIdx = orderMap.get(b.id) ?? Infinity
      return aIdx - bIdx
    })
  })()

  // Apply drag reordering for live visual feedback
  const displayedTasks = (() => {
    if (!dragState) return orderedTasks
    const tasks = [...orderedTasks]
    const draggedIdx = tasks.findIndex((t) => t.id === dragState.draggedId)
    if (draggedIdx === -1) return tasks
    const [item] = tasks.splice(draggedIdx, 1)
    tasks.splice(dragState.insertIndex, 0, item)
    return tasks
  })()

  useEffect(() => {
    if (!dragState) return

    const snapshot = orderedTasks
    const originalIndex = snapshot.findIndex((t) => t.id === dragState.draggedId)
    const { cardHeight } = dragState

    const handleMove = (e: TouchEvent) => {
      e.preventDefault()
      const touch = e.touches[0]
      if (!touch || !dragStateRef.current) return
      const deltaY = touch.clientY - dragStateRef.current.startY
      const steps = Math.round(deltaY / cardHeight)
      const newInsertIndex = Math.max(0, Math.min(snapshot.length - 1, originalIndex + steps))
      setDragState((prev) => (prev ? { ...prev, deltaY, insertIndex: newInsertIndex } : null))
    }

    const handleEnd = () => {
      const current = dragStateRef.current
      if (!current) return
      const tasks = [...snapshot]
      const draggedIdx = tasks.findIndex((t) => t.id === current.draggedId)
      if (draggedIdx !== -1) {
        const [item] = tasks.splice(draggedIdx, 1)
        tasks.splice(current.insertIndex, 0, item)
        const newOrder = tasks.map((t) => t.id)
        setLocalOrder(newOrder)
        saveTodayTaskOrder(newOrder)
      }
      setDragState(null)
    }

    document.addEventListener("touchmove", handleMove, { passive: false })
    document.addEventListener("touchend", handleEnd)
    document.addEventListener("touchcancel", handleEnd)

    return () => {
      document.removeEventListener("touchmove", handleMove)
      document.removeEventListener("touchend", handleEnd)
      document.removeEventListener("touchcancel", handleEnd)
    }
  }, [dragState?.draggedId]) // eslint-disable-line react-hooks/exhaustive-deps

  const goBack = () => {
    const newDate = new Date(selectedDate)
    newDate.setDate(newDate.getDate() - 1)
    setSelectedDate(newDate)
  }

  const goForward = () => {
    const newDate = new Date(selectedDate)
    newDate.setDate(newDate.getDate() + 1)
    setSelectedDate(newDate)
  }

  const formatDate = (date: Date) => {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]
    return `${days[date.getDay()]} ${months[date.getMonth()]} ${date.getDate()}`
  }

  return (
    <div className="home-view">
      <div className="view-header">
        <div
          style={{
            display: "flex",
            gap: "12px",
            alignItems: "center",
            marginBottom: "20px",
            justifyContent: "center",
          }}
        >
          <button
            className="btn btn-secondary btn-sm"
            onClick={goBack}
            style={{ whiteSpace: "nowrap" }}
          >
            ← Prev
          </button>
          <div
            style={{ minWidth: "120px", textAlign: "center", fontSize: "16px", fontWeight: "500" }}
          >
            {formatDate(selectedDate)}
          </div>
          <button
            className="btn btn-secondary btn-sm"
            onClick={goForward}
            style={{ whiteSpace: "nowrap" }}
          >
            Next →
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={onUndo}
            disabled={!canUndo}
            style={{
              marginLeft: "12px",
              padding: "6px",
              fontSize: "16px",
              width: "34px",
              height: "34px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Undo last action"
          >
            ↶
          </button>
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => window.location.reload()}
            style={{
              marginLeft: "8px",
              padding: "6px",
              fontSize: "16px",
              width: "34px",
              height: "34px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Reload to get the latest version"
          >
            ↻
          </button>
        </div>
      </div>

      {state.locations.length > 0 && (
        <div className="location-filter">
          <div className="location-list">
            {state.locations.map((location) => (
              <label key={location.id} className="location-chip">
                <input
                  type="checkbox"
                  checked={locationsIdsSelected.includes(location.id)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setLocationIdsSelected((prev) => [...prev, location.id])
                    } else {
                      setLocationIdsSelected((prev) => prev.filter((id) => id !== location.id))
                    }
                  }}
                />
                {location.name}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="task-list" ref={taskListRef}>
        {displayedTasks.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">✨</div>
            <h3>{isToday ? "All done" : "Nothing scheduled on this day"}</h3>
          </div>
        ) : (
          displayedTasks.map((task) => {
            const isSnoozed = state.snoozedTasks[task.id]
            const isBeingDragged = dragState?.draggedId === task.id
            return (
              <DraggableDiv
                key={task.id}
                disabled={dragState !== null}
                className={isBeingDragged ? "task-card-reordering" : ""}
                onClick={dragState === null ? () => setSelectedTaskId(task.id) : undefined}
                onDragged={() => {
                  setState(addTaskCompletion(state, task.id, isPast ? selectedDate : new Date()), "Complete task")
                }}
                onSwipeLeft={() => {
                  setState(snoozeTask(state, task.id, new Date()), "Snooze task")
                }}
                swipeLeftDisabled={isPast}
              >
                <div className="task-card-content">
                  <div className="task-name">{task.name}</div>
                  {task.description && <div className="task-description">{task.description}</div>}
                  <div className="task-meta">
                    {task.locationIds.length > 0 && (
                      <>
                        {task.locationIds.map((locId) => {
                          const location = state.locations.find((l) => l.id === locId)
                          return location ? (
                            <span key={locId} className="task-location-badge">
                              {location.name}
                            </span>
                          ) : null
                        })}
                      </>
                    )}
                    {isSnoozed && <span className="snoozed-indicator">💤 Snoozed</span>}
                  </div>
                </div>
                {isToday && (
                  <div
                    className="drag-handle"
                    onTouchStart={(e) => {
                      e.stopPropagation()
                      const touch = e.touches[0]
                      if (!touch) return
                      const index = orderedTasks.findIndex((t) => t.id === task.id)
                      if (index === -1) return
                      let cardHeight = 88
                      if (taskListRef.current) {
                        const cards = taskListRef.current.querySelectorAll(".task-card")
                        if (cards.length > 0) {
                          cardHeight = cards[0].getBoundingClientRect().height + 8
                        }
                      }
                      setDragState({
                        draggedId: task.id,
                        startY: touch.clientY,
                        deltaY: 0,
                        insertIndex: index,
                        originalIndex: index,
                        cardHeight,
                      })
                    }}
                  >
                    ⠿
                  </div>
                )}
              </DraggableDiv>
            )
          })
        )}
      </div>

      <TaskDetailModal
        isOpen={selectedTaskId !== null}
        onClose={() => setSelectedTaskId(null)}
        task={selectedTaskId ? state.tasks.find((t) => t.id === selectedTaskId) || null : null}
                 taskId={selectedTaskId}
         state={state}
         onEdit={(taskId) => {
           setEditingTaskId(taskId)
           setSelectedTaskId(null)
         }}
       />

      <TaskEditModal
        isOpen={editingTaskId !== null}
        onClose={() => setEditingTaskId(null)}
        task={editingTaskId ? state.tasks.find((t) => t.id === editingTaskId) || null : null}
        state={state}
        onSubmit={(updatedTask) => {
          const newTasks = state.tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t))
          setState(
            {
              ...state,
              tasks: newTasks,
            },
            "Edit task",
          )
          setEditingTaskId(null)
        }}
      />
    </div>
  )
}

function ManageTasksView({
  state,
  setState,
}: {
  state: State
  setState: (s: State, action?: ActionType) => void
}) {
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)

  return (
    <div className="manage-view">
      <h2>📋 Tasks</h2>
      <div style={{ marginBottom: "20px" }}>
        <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
          ➕ Add New Task
        </button>
      </div>

      <TaskFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={(task) => {
          setState(
            {
              ...state,
              tasks: [...state.tasks, task],
            },
            "Add task",
          )
        }}
        state={state}
      />

      <div className="item-list">
        {state.tasks.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">📝</div>
            <h3>No tasks yet</h3>
            <p>Create your first task to get started</p>
          </div>
        ) : (
          state.tasks.map((task) => (
            <div key={task.id} className="item-card">
              <div className="item-info">
                <h3>{task.name}</h3>
                {task.description && <p>{task.description}</p>}
                <div style={{ marginTop: "8px", fontSize: "12px", color: "#999" }}>
                  {(() => {
                    const lastCompleted = state.mostRecentTaskCompletions[task.id]
                    const lastSnoozedTs = state.snoozedTasks[task.id]
                    const lastSnoozed = lastSnoozedTs !== undefined ? dayOfDate(new Date(lastSnoozedTs)) : undefined
                    const nextDayNum = getNextScheduledDayNumber(task, lastCompleted, lastSnoozed)
                    const nextLabel = formatNextScheduledDay(nextDayNum)
                    const freqLabel =
                      task.schedule.t === "interval"
                        ? `Every ${task.schedule.intervalInDays} day(s)`
                        : task.schedule.t === "weekly"
                          ? "Weekly"
                          : "Monthly"

                    const lastActivityTs =
                      lastCompleted !== undefined && lastSnoozedTs !== undefined
                        ? Math.max(lastCompleted, lastSnoozedTs)
                        : lastCompleted ?? lastSnoozedTs
                    const lastActivityLabel = (() => {
                      if (lastActivityTs === undefined) return null
                      const isSnooze = lastSnoozedTs !== undefined && lastActivityTs === lastSnoozedTs && lastActivityTs !== lastCompleted
                      const date = new Date(lastActivityTs)
                      const formatted = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
                      return `${isSnooze ? "Snoozed" : "Last done"}: ${formatted}`
                    })()

                    return (
                      <>
                        {`${freqLabel} · Next: ${nextLabel}`}
                        {lastActivityLabel && <div style={{ marginTop: "2px", opacity: 0.75 }}>{lastActivityLabel}</div>}
                      </>
                    )
                  })()}
                </div>
              </div>
              <div className="item-actions">
                 <button className="btn btn-secondary btn-sm" onClick={() => setEditingTaskId(task.id)}>Edit</button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setState(deleteTask(state, task.id), "Delete task")}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
       <TaskEditModal
         isOpen={editingTaskId !== null}
         onClose={() => setEditingTaskId(null)}
         task={editingTaskId ? state.tasks.find((t) => t.id === editingTaskId) || null : null}
         state={state}
         onSubmit={(updatedTask) => {
           const newTasks = state.tasks.map((t) => (t.id === updatedTask.id ? updatedTask : t))
           setState(
             {
               ...state,
               tasks: newTasks,
             },
             "Edit task",
           )
           setEditingTaskId(null)
         }}
       />
    </div>
  )
}

function ManageLocationsView({
  state,
  setState,
}: {
  state: State
  setState: (s: State, action?: ActionType) => void
}) {
  const [isModalOpen, setIsModalOpen] = useState(false)

  return (
    <div className="manage-view">
      <h2>📍 Locations</h2>
      <div style={{ marginBottom: "20px" }}>
        <button className="btn btn-primary" onClick={() => setIsModalOpen(true)}>
          ➕ Add New Location
        </button>
      </div>

      <LocationFormModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={(location) => {
          setState(addLocation(state, location), "Add location")
        }}
      />

      <div className="item-list">
        {state.locations.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">🏠</div>
            <h3>No locations yet</h3>
            <p>Add a location to organize your tasks</p>
          </div>
        ) : (
          state.locations.map((location) => (
            <div key={location.id} className="item-card">
              <div className="item-info">
                <h3>{location.name}</h3>
                {location.description && (
                  <p style={{ fontSize: "13px", color: "#666", margin: "4px 0 8px 0" }}>
                    {location.description}
                  </p>
                )}
                <p style={{ fontSize: "12px" }}>
                  {state.tasks.filter((t) => t.locationIds.includes(location.id)).length} tasks
                </p>
              </div>
              <div className="item-actions">
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setState(deleteLocation(state, location.id), "Delete location")}
                >
                  Delete
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function Toast({ message, isVisible }: { message: string; isVisible: boolean }) {
  return (
    <div
      style={{
        position: "fixed",
        bottom: "20px",
        left: "50%",
        transform: "translateX(-50%)",
        backgroundColor: "#333",
        color: "#fff",
        padding: "12px 20px",
        borderRadius: "8px",
        fontSize: "14px",
        pointerEvents: "none",
        opacity: isVisible ? 1 : 0,
        transition: "opacity 0.3s ease",
        zIndex: 200,
      }}
    >
      {message}
    </div>
  )
}

function App() {
  const savedState = getStateFromLocalStorage()
  const [state, _setState] = useState(savedState || initialState)
  const [stateHistory, setStateHistory] = useState<State[]>([])
  const [actionHistory, setActionHistory] = useState<ActionType[]>([])
  const [validationError, setValidationError] = useState<string | null>(null)
  const [toastMessage, setToastMessage] = useState<string>("")
  const [showToast, setShowToast] = useState(false)

  function setState(s: State, action?: ActionType) {
    const zodParsed = stateSchema.safeParse(s)
    if (!zodParsed.success) {
      setValidationError("Invalid state data: " + zodParsed.error.message)
      return
    }

    localStorage.setItem("__workout_state", JSON.stringify(s))
    setStateHistory((prev) => [...prev, state].slice(-9))
    if (action) {
      setActionHistory((prev) => [...prev, action].slice(-9))
    }
    _setState(s)
  }

  function handleUndo() {
    if (stateHistory.length > 0) {
      const previousState = stateHistory[stateHistory.length - 1]
      const lastAction = actionHistory[actionHistory.length - 1]
      localStorage.setItem("__workout_state", JSON.stringify(previousState))
      _setState(previousState)
      setStateHistory((prev) => prev.slice(0, -1))
      setActionHistory((prev) => prev.slice(0, -1))

      if (lastAction) {
        setToastMessage(`Undone: ${lastAction}`)
        setShowToast(true)
        setTimeout(() => setShowToast(false), 2000)
      }
    }
  }

  const [view, setView] = useState<"home" | "manage-tasks" | "manage-locations">("home")

  if (validationError) {
    return (
      <div className="error-screen">
        <h2>⚠️ Data Error</h2>
        <p>{validationError}</p>
        <button
          className="btn btn-primary"
          onClick={() => {
            localStorage.setItem("__workout_state", JSON.stringify(initialState))
            _setState(initialState)
            setValidationError(null)
          }}
        >
          Continue with Fresh Data
        </button>
      </div>
    )
  }

  const meat = (() => {
    switch (view) {
      case "home":
        return (
          <HomeView
            state={state}
            setState={setState}
            onUndo={handleUndo}
            canUndo={stateHistory.length > 0}
          />
        )
      case "manage-tasks":
        return <ManageTasksView state={state} setState={setState} />
      case "manage-locations":
        return <ManageLocationsView state={state} setState={setState} />
    }
  })()

  return (
    <div className="app-container">
      <div className="app-content">{meat}</div>

      <nav className="app-nav">
        <button className={view === "home" ? "active" : ""} onClick={() => setView("home")}>
          🏠 Home
        </button>
        <button
          className={view === "manage-tasks" ? "active" : ""}
          onClick={() => setView("manage-tasks")}
        >
          📋 Tasks
        </button>
        <button
          className={view === "manage-locations" ? "active" : ""}
          onClick={() => setView("manage-locations")}
        >
          📍 Locations
        </button>
      </nav>
      <Toast message={toastMessage} isVisible={showToast} />
    </div>
  )
}

export default App
