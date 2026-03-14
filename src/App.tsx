import { useState } from "react"
import * as z from "zod"
import "./App.css"

const locationSchema = z.object({
  id: z.string(),
  name: z.string(),
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

const createLocation = (name: string): Location => {
  return {
    id: crypto.randomUUID(),
    name,
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
  return {
    ...state,
    mostRecentTaskCompletions: { ...state.mostRecentTaskCompletions, [taskId]: asof.getTime() },
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

function dayOfDate(date: Date): number {
  // days start and end at 2am
  // prints a number that can be used for subtraction and comparison
  // NOT day of year
  const adjustedDate = new Date(date)
  adjustedDate.setHours(adjustedDate.getHours() - 2)
  return Math.floor(adjustedDate.getTime() / (1000 * 60 * 60 * 24))
}

function testDayOfDate() {
  // between Jan 1,1990 at 1am and jan 1 1990 at 3am, there should be 1 day
  const date1 = new Date("1990-01-01T01:00:00Z")
  const date2 = new Date("1990-01-01T03:00:00Z")
  console.assert(dayOfDate(date1) === dayOfDate(date2), "Test failed")
  // between jan 1, 1990 at 1am and jan 1 1990 at 1:30 am, there should be 0 days
  const date3 = new Date("1990-01-01T01:30:00Z")
  console.assert(dayOfDate(date1) === dayOfDate(date3), "Test failed")
  // between jan 1, 1990 and jan 1, 1991 there should be more than 300 days
  const date4 = new Date("1990-01-01T00:00:00Z")
  const date5 = new Date("1991-01-01T00:00:00Z")
  console.assert(dayOfDate(date5) - dayOfDate(date4) > 300, "Test failed")
  // between jan 1, 1990 at 4pm and jan 2, 1990 at 4pm there should be 1 day
  const date6 = new Date("1990-01-01T16:00:00Z")
  const date7 = new Date("1990-01-02T16:00:00Z")
  console.assert(dayOfDate(date6) === dayOfDate(date7), "Test failed")
}
testDayOfDate()

function setIntersection<T>(a: Set<T>, b: Set<T>): Set<T> {
  const intersection = new Set<T>()
  for (const item of a) {
    if (b.has(item)) {
      intersection.add(item)
    }
  }
  return intersection
}

const isTaskDueOnDay = (
  task: Task,
  dayOfDateValue: number,
  lastCompletedTime: number | undefined,
  lastSnoozedDay: number | undefined,
  asof: Date,
): boolean => {
  if (task.schedule.t === "interval") {
    // If snoozed today, not due
    if (lastSnoozedDay !== undefined && lastSnoozedDay === dayOfDateValue) {
      return false
    }
    // If never completed, due
    if (!lastCompletedTime) {
      return true
    }
    // If enough days have passed since completion, due
    const lastCompletedDay = dayOfDate(new Date(lastCompletedTime))
    return dayOfDateValue - lastCompletedDay >= task.schedule.intervalInDays
  }

  if (task.schedule.t === "weekly") {
    const dayOfWeek = asof.getDay()
    return task.schedule.daysOfWeek.includes(dayOfWeek)
  }

  if (task.schedule.t === "monthly") {
    const dayOfMonth = asof.getDate()
    return dayOfMonth === task.schedule.dayOfMonth
  }

  return false
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

    if (isTaskDueOnDay(task, dayOfDateValue, lastCompleted, lastSnoozedDay, asof)) {
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

function DraggableDiv({
  children,
  onDragged,
  onSwipeLeft,
}: {
  children: React.ReactNode
  onDragged: (event: React.DragEvent<HTMLDivElement>) => void
  onSwipeLeft: (event: React.DragEvent<HTMLDivElement>) => void
}) {
  const [state, setStatus] = useState<{ t: "idle" } | { t: "dragging"; startX: number }>({
    t: "idle",
  })
  const [dragDelta, setDragDelta] = useState(0)

  return (
    <div
      draggable
      className={`task-card ${state.t === "dragging" ? "dragging" : ""}`}
      onDragStart={(ev) => {
        setStatus({ t: "dragging", startX: ev.clientX })
        setDragDelta(0)
      }}
      onDrag={(ev) => {
        if (state.t === "dragging" && ev.clientX) {
          setDragDelta(ev.clientX - state.startX)
        }
      }}
      onDragEnd={(ev) => {
        if (state.t === "dragging") {
          const deltaX = ev.clientX - state.startX
          if (deltaX > 30) {
            onDragged(ev)
          }
          if (deltaX < -30) {
            onSwipeLeft(ev)
          }
        }
        setStatus({ t: "idle" })
        setDragDelta(0)
      }}
      style={{
        transform: dragDelta !== 0 ? `translateX(${dragDelta * 0.3}px)` : undefined,
      }}
    >
      <div className="task-card-hint">
        <span className="task-card-hint-left">← Snooze</span>
        <span className="task-card-hint-right">Complete →</span>
      </div>
      {children}
    </div>
  )
}

function HomeView({ state, setState }: { state: State; setState: (s: State) => void }) {
  const [locationsIdsSelected, setLocationIdsSelected] = useState<string[]>([])
  const [selectedDate, setSelectedDate] = useState<Date>(new Date())
  const tasksAtLocation = getTasksDueAtLocations(state, locationsIdsSelected, selectedDate)

  const dateStr = selectedDate.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })

  return (
    <div className="home-view">
      <div className="view-header">
        <div className="date-picker-section">
          <label>
            📅 View tasks for:
            <input
              type="date"
              value={selectedDate.toISOString().split("T")[0]}
              onChange={(e) => setSelectedDate(new Date(e.target.value))}
            />
          </label>
          <div style={{ marginTop: "8px", fontSize: "12px", color: "#999" }}>
            {dateStr}
          </div>
        </div>
      </div>

      {state.locations.length > 0 && (
        <div className="location-filter">
          <div className="filter-title">📍 Filter by location</div>
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

      <div className="task-list">
        {tasksAtLocation.length === 0 ? (
          <div className="empty-state">
            <div className="empty-state-icon">✨</div>
            <h3>All caught up!</h3>
            <p>You have no tasks for this day</p>
          </div>
        ) : (
          tasksAtLocation.map((task) => {
            const isSnoozed = state.snoozedTasks[task.id]
            return (
              <DraggableDiv
                key={task.id}
                onDragged={() => {
                  setState(addTaskCompletion(state, task.id, new Date()))
                }}
                onSwipeLeft={() => {
                  setState(snoozeTask(state, task.id, new Date()))
                }}
              >
                <div className="task-card-content">
                  <div className="task-name">✓ {task.name}</div>
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
                    {isSnoozed && (
                      <span className="snoozed-indicator">
                        💤 Snoozed
                      </span>
                    )}
                  </div>
                </div>
              </DraggableDiv>
            )
          })
        )}
      </div>
    </div>
  )
}

function ManageTasksView({ state, setState }: { state: State; setState: (s: State) => void }) {
  return (
    <div className="manage-view">
      <h2>📋 Tasks</h2>
      <div style={{ marginBottom: "20px" }}>
        <button className="btn btn-primary">
          ➕ Add New Task
        </button>
      </div>
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
                  {task.schedule.t === "interval"
                    ? `Every ${task.schedule.intervalInDays} day(s)`
                    : task.schedule.t === "weekly"
                      ? "Weekly"
                      : "Monthly"}
                </div>
              </div>
              <div className="item-actions">
                <button className="btn btn-secondary btn-sm">Edit</button>
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setState(deleteTask(state, task.id))}
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

function ManageLocationsView({ state, setState }: { state: State; setState: (s: State) => void }) {
  return (
    <div className="manage-view">
      <h2>📍 Locations</h2>
      <div style={{ marginBottom: "20px" }}>
        <button
          className="btn btn-primary"
          onClick={() => setState(addLocation(state, createLocation("New Location")))}
        >
          ➕ Add New Location
        </button>
      </div>
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
                <p style={{ fontSize: "12px" }}>
                  {state.tasks.filter((t) => t.locationIds.includes(location.id)).length} tasks
                </p>
              </div>
              <div className="item-actions">
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => setState(deleteLocation(state, location.id))}
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

function App() {
  const savedState = getStateFromLocalStorage()
  const [state, _setState] = useState(savedState || initialState)
  const [stateHistory, setStateHistory] = useState<State[]>([])
  const [validationError, setValidationError] = useState<string | null>(null)

  function setState(s: State) {
    const zodParsed = stateSchema.safeParse(s)
    if (!zodParsed.success) {
      setValidationError("Invalid state data: " + zodParsed.error.message)
      return
    }

    localStorage.setItem("__workout_state", JSON.stringify(s))
    setStateHistory((prev) => [...prev, state].slice(-9))
    _setState(s)
  }

  function handleUndo() {
    if (stateHistory.length > 0) {
      const previousState = stateHistory[stateHistory.length - 1]
      localStorage.setItem("__workout_state", JSON.stringify(previousState))
      _setState(previousState)
      setStateHistory((prev) => prev.slice(0, -1))
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
        return <HomeView state={state} setState={setState} />
      case "manage-tasks":
        return <ManageTasksView state={state} setState={setState} />
      case "manage-locations":
        return <ManageLocationsView state={state} setState={setState} />
    }
  })()

  return (
    <div className="app-container">
      <div className="app-header">
        <h1>💪 Workout Planner</h1>
        <button className="btn btn-secondary btn-sm" onClick={handleUndo} disabled={stateHistory.length === 0}>
          ↶ Undo
        </button>
      </div>

      <div className="app-content">
        {meat}
      </div>

      <nav className="app-nav">
        <button
          className={view === "home" ? "active" : ""}
          onClick={() => setView("home")}
        >
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
    </div>
  )
}

export default App
