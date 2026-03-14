import { useState } from "react"
import reactLogo from "./assets/react.svg"
import viteLogo from "/vite.svg"
import "./App.css"
import * as z from "zod"

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
      dayOfMonth: z.number(),
    }),
    z.object({
      // least common type
      t: z.literal("weekly"),
      dayOfWeek: z.number().min(0).max(6), // 0 is sunday
    }),
  ]),
})

type Task = z.infer<typeof taskSchema>

const stateSchema = z.object({
  locations: z.array(locationSchema),
  tasks: z.array(taskSchema),
  mostRecentTaskCompletions: z.record(z.string(), z.number()),
})

type State = z.infer<typeof stateSchema>

const createTask = (
  name: string,
  description: string,
  locationIds: string[],
  intervalInDays: number,
): Task => {
  return {
    id: crypto.randomUUID(),
    name,
    description,
    locationIds,
    intervalInDays,
  }
}

const initialState: State = {
  locations: [],
  tasks: [],
  mostRecentTaskCompletions: {},
}

const createLocation = (name: string): Location => {
  return {
    id: crypto.randomUUID(),
    name,
  }
}
const addLocation = (state: State, location: Location): State => {
  return {
    ...state,
    locations: [...state.locations, location],
  }
}

const addTask = (state: State, task: Task): State => {
  return {
    ...state,
    tasks: [...state.tasks, task],
  }
}

const addTaskCompletion = (state: State, taskId: string, asof: Date): State => {
  return {
    ...state,
    mostRecentTaskCompletions: { ...state.mostRecentTaskCompletions, [taskId]: asof.getTime() },
  }
}

// needed to manage tasks
const replaceTask = (state: State, task: Task): State => {
  return {
    ...state,
    tasks: state.tasks.map((t) => (t.id === task.id ? task : t)),
  }
}

// needed to manage locations
const replaceLocation = (state: State, location: Location): State => {
  return {
    ...state,
    locations: state.locations.map((l) => (l.id === location.id ? location : l)),
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

const getTasksDueAtLocations = (state: State, locationIds: string[], asof: Date): Task[] => {
  // a task is due if either:
  // - it has no completion records
  // - its last completion was more than its interval ago
  // how to calculate intervals ago:
  // 1. Find the most recent completion for the task
  // 2. If it doesn't exist, the task is due
  // 3. If it does exist, calculate the day
  // days start and end at 2am
  // compare to the current day
  // sort the tasks from most overdue to least overdue, based on timestamp

  const tasksAtLocations = state.tasks.filter(
    (task) =>
      locationIds.length === 0 ||
      setIntersection(new Set(locationIds), new Set(task.locationIds)).size > 0,
  )

  const tasksDue: Task[] = []
  for (const task of tasksAtLocations) {
    const lastCompleted = state.mostRecentTaskCompletions[task.id]

    if (!lastCompleted) {
      tasksDue.push(task)
    } else {
      // find the day of the task

      const lastCompletedDay = dayOfDate(new Date(lastCompleted))
      const currentDay = dayOfDate(asof)
      if (currentDay - lastCompletedDay >= task.intervalInDays) {
        tasksDue.push(task)
      }
    }
  }

  // put tasks that have never been completed first, followed by the tasks with the furthest last completion date
  tasksDue.sort((a, b) => {
    const aLastCompleted = state.mostRecentTaskCompletions[a.id]
    const bLastCompleted = state.mostRecentTaskCompletions[b.id]

    if (!aLastCompleted && !bLastCompleted) {
      return 0
    }
    if (!aLastCompleted) {
      return 1
    }
    if (!bLastCompleted) {
      return -1
    }
    return aLastCompleted - bLastCompleted
  })

  return tasksDue
}

function getStateFromLocalStorage(): State {
  // get __workout_state from localstorage
  const state = localStorage.getItem("__workout_state")
  if (!state) return initialState
  const candidate = JSON.parse(state)
  const zodParsed = stateSchema.safeParse(candidate)

  if (!zodParsed.success) {
    window.alert("invalid localstorage")
    return initialState
  }

  return zodParsed.data
}

function DraggableDiv({
  children,
  onDragged,
}: {
  children: React.ReactNode
  onDragged: (event: React.DragEvent<HTMLDivElement>) => void
}) {
  const [state, setStatus] = useState<{ t: "idle" } | { t: "dragging"; startX: number }>({
    t: "idle",
  })
  return (
    <div
      draggable
      onDragStart={(ev) => {
        setStatus({ t: "dragging", startX: ev.clientX })
      }}
      onDragEnd={(ev) => {
        // if we dragged it more than 30 pixels to the right, call onDragged
        if (state.t === "dragging" && ev.clientX - state.startX > 30) {
          onDragged(ev)
        }
        setStatus({ t: "idle" })
      }}
    >
      {children}
    </div>
  )
}

function HomeView({ state, setState }: { state: State; setState: (s: State) => void }) {
  const [locationsIdsSelected, setLocationIdsSelected] = useState<string[]>([])
  const tasksAtLocation = getTasksDueAtLocations(state, locationsIdsSelected, new Date())

  return (
    <div>
      {/* one checkmark for each location */}
      {state.locations.map((location) => (
        <label key={location.id}>
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

      {tasksAtLocation.map((task) => (
        <DraggableDiv
          onDragged={() => {
            // If you drag a task to the right, it should be marked as complete
            const newState: State = addTaskCompletion(state, task.id, new Date())
            setState(newState)
          }}
        >
          <div>{task.name}</div>
        </DraggableDiv>
      ))}
    </div>
  )
}

function App() {
  const [state, _setState] = useState(getStateFromLocalStorage())
  function setState(s: State) {
    // store it in localstorage
    localStorage.setItem("__workout_state", JSON.stringify(s))
    _setState(s)
  }
  const [view, setView] = useState<"home" | "manage-tasks" | "manage-locations">("home")
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
  return <div>{meat}</div>
}

export default App
