import * as z from "zod"

const locationSchema = z.object({
  id: z.string(),
  name: z.string(),
})

export type Location = z.infer<typeof locationSchema>

const taskSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  locationIds: z.array(z.string()),
  schedule: z.union([
    z.object({
      t: z.literal("interval"),
      intervalInDays: z.number(),
    }),
    z.object({
      t: z.literal("monthly"),
      dayOfMonth: z.number().min(0).max(28),
    }),
    z.object({
      t: z.literal("weekly"),
      daysOfWeek: z.array(z.number().min(0).max(6)),
    }),
  ]),
})

export type Task = z.infer<typeof taskSchema>

export function dayOfDate(date: Date): number {
  // days start and end at midnight
  // prints a number that can be used for subtraction and comparison
  // NOT day of year
  return Math.floor(date.getTime() / (1000 * 60 * 60 * 24))
}

export function getNextScheduledDayNumber(
  task: Task,
  lastCompletedTime: number | undefined,
  lastSnoozedDay: number | undefined,
): number {
  const today = dayOfDate(new Date())

  if (lastSnoozedDay !== undefined) {
    const snoozedNextDay = lastSnoozedDay + 1
    if (snoozedNextDay >= today) {
      return snoozedNextDay
    }
  }

  if (task.schedule.t === "interval") {
    if (!lastCompletedTime) return today
    const lastCompletedDay = dayOfDate(new Date(lastCompletedTime))
    return lastCompletedDay + task.schedule.intervalInDays
  }

  if (task.schedule.t === "weekly") {
    const dayOfWeek = new Date().getDay()
    let minDiff = 7
    for (const d of task.schedule.daysOfWeek) {
      const diff = (d - dayOfWeek + 7) % 7
      if (diff < minDiff) minDiff = diff
    }
    return today + minDiff
  }

  if (task.schedule.t === "monthly") {
    const now = new Date()
    const { dayOfMonth } = task.schedule
    if (dayOfMonth >= now.getDate()) {
      return dayOfDate(new Date(now.getFullYear(), now.getMonth(), dayOfMonth))
    }
    return dayOfDate(new Date(now.getFullYear(), now.getMonth() + 1, dayOfMonth))
  }

  return today
}

export function formatNextScheduledDay(dayNum: number): string {
  const today = dayOfDate(new Date())
  const diff = dayNum - today
  if (diff <= 0) return "Today"
  if (diff === 1) return "Tomorrow"
  const date = new Date(dayNum * 24 * 60 * 60 * 1000)
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
}

export const isTaskDueOnDay = (
  task: Task,
  dayOfDateValue: number,
  lastCompletedTime: number | undefined,
  lastSnoozedDay: number | undefined,
  asof: Date,
  asofIsToday: boolean,
): boolean => {
  const now = dayOfDate(new Date())

  if (lastSnoozedDay !== undefined) {
    if (asofIsToday) {
      // snoozeDay is always <= today; hide if snoozed today, show if snoozed before today
      return lastSnoozedDay !== dayOfDateValue
    }
    if (dayOfDateValue === lastSnoozedDay + 1) return true

    if (task.schedule.t === "interval") {
      return false
    }
  }

  if (task.schedule.t === "interval") {
    const lastCompletedDay = lastCompletedTime ? dayOfDate(new Date(lastCompletedTime)) : -Infinity

    if (!lastCompletedTime) {
      // Never completed - only due when checking today
      return asofIsToday
    }

    if (lastCompletedDay !== -Infinity) {
      const showDay = lastCompletedDay + task.schedule.intervalInDays
      if (asofIsToday) {
        // Show if scheduled for today or overdue
        return showDay <= dayOfDateValue
      } else {
        // Show only on exact scheduled day, and only if it's in the future
        return dayOfDateValue === showDay && dayOfDateValue > now
      }
    }

    return false
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
