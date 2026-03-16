import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { isTaskDueOnDay, dayOfDate, type Task } from "./taskUtils"

describe("Interval Task Visibility", () => {
  let currentDate: Date

  beforeEach(() => {
    // Mock the current date to March 14, 2026
    currentDate = new Date("2026-03-14T12:00:00Z")
    vi.useFakeTimers()
    vi.setSystemTime(currentDate)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("should show daily task only on the day after completion", () => {
    // Create a daily task
    const task: Task = {
      id: "task1",
      name: "Daily Task",
      description: "",
      locationIds: [],
      schedule: {
        t: "interval",
        intervalInDays: 1, // Daily
      },
    }

    // Task completed on March 14
    const completionDate = new Date("2026-03-14T10:00:00Z")
    const completionTime = completionDate.getTime()

    // Check each day
    const testCases = [
      { date: "2026-03-14T00:00:00Z", shouldShow: false, day: "March 14 (completion day)" },
      { date: "2026-03-15T00:00:00Z", shouldShow: true, day: "March 15 (next day)" },
      { date: "2026-03-16T00:00:00Z", shouldShow: false, day: "March 16" },
      { date: "2026-03-17T00:00:00Z", shouldShow: false, day: "March 17" },
    ]

    for (const testCase of testCases) {
      const testDate = new Date(testCase.date)
      const dayNum = dayOfDate(testDate)
      const isDue = isTaskDueOnDay(task, dayNum, completionTime, undefined, testDate)
      expect(isDue, `${testCase.day} should ${testCase.shouldShow ? "show" : "not show"}`).toBe(testCase.shouldShow)
    }
  })

  it("should show every-2-days task only on the correct day", () => {
    const task: Task = {
      id: "task2",
      name: "Every 2 Days Task",
      description: "",
      locationIds: [],
      schedule: {
        t: "interval",
        intervalInDays: 2, // Every 2 days
      },
    }

    const completionDate = new Date("2026-03-14T10:00:00Z")
    const completionTime = completionDate.getTime()

    const testCases = [
      { date: "2026-03-14T00:00:00Z", shouldShow: false, day: "March 14" },
      { date: "2026-03-15T00:00:00Z", shouldShow: false, day: "March 15" },
      { date: "2026-03-16T00:00:00Z", shouldShow: true, day: "March 16 (2 days later)" },
      { date: "2026-03-17T00:00:00Z", shouldShow: false, day: "March 17" },
      { date: "2026-03-18T00:00:00Z", shouldShow: false, day: "March 18" },
    ]

    for (const testCase of testCases) {
      const testDate = new Date(testCase.date)
      const dayNum = dayOfDate(testDate)
      const isDue = isTaskDueOnDay(task, dayNum, completionTime, undefined, testDate)
      expect(isDue, `${testCase.day} should ${testCase.shouldShow ? "show" : "not show"}`).toBe(testCase.shouldShow)
    }
  })

  it("should show snoozed task only on the next day", () => {
    const task: Task = {
      id: "task3",
      name: "Snoozed Task",
      description: "",
      locationIds: [],
      schedule: {
        t: "interval",
        intervalInDays: 1,
      },
    }

    // Snoozed on March 14 (stored as day number)
    const snoozeDate = new Date("2026-03-14T00:00:00Z")
    const snoozeDayNum = dayOfDate(snoozeDate)

    const testCases = [
      { date: "2026-03-14T00:00:00Z", shouldShow: false, day: "March 14 (snooze day)" },
      { date: "2026-03-15T00:00:00Z", shouldShow: true, day: "March 15 (next day)" },
      { date: "2026-03-16T00:00:00Z", shouldShow: false, day: "March 16" },
    ]

    for (const testCase of testCases) {
      const testDate = new Date(testCase.date)
      const dayNum = dayOfDate(testDate)
      const isDue = isTaskDueOnDay(task, dayNum, undefined, snoozeDayNum, testDate)
      expect(isDue, `${testCase.day} should ${testCase.shouldShow ? "show" : "not show"}`).toBe(testCase.shouldShow)
    }
  })

  it("should prefer snooze over completion when both exist", () => {
    const task: Task = {
      id: "task4",
      name: "Completed and Snoozed Task",
      description: "",
      locationIds: [],
      schedule: {
        t: "interval",
        intervalInDays: 1,
      },
    }

    // Completed on March 12
    const completionDate = new Date("2026-03-12T10:00:00Z")
    const completionTime = completionDate.getTime()

    // Snoozed on March 14
    const snoozeDate = new Date("2026-03-14T00:00:00Z")
    const snoozeDayNum = dayOfDate(snoozeDate)

    const testCases = [
      { date: "2026-03-13T00:00:00Z", shouldShow: false, day: "March 13" },
      { date: "2026-03-15T00:00:00Z", shouldShow: true, day: "March 15 (next day after snooze)" },
      { date: "2026-03-16T00:00:00Z", shouldShow: false, day: "March 16" },
    ]

    for (const testCase of testCases) {
      const testDate = new Date(testCase.date)
      const dayNum = dayOfDate(testDate)
      const isDue = isTaskDueOnDay(task, dayNum, completionTime, snoozeDayNum, testDate)
      expect(isDue, `${testCase.day} should ${testCase.shouldShow ? "show" : "not show"}`).toBe(testCase.shouldShow)
    }
  })

  it("should not show completed tasks in the past", () => {
    const task: Task = {
      id: "task5",
      name: "Past Task",
      description: "",
      locationIds: [],
      schedule: {
        t: "interval",
        intervalInDays: 1,
      },
    }

    // Complete task on March 12 (two days ago from our mocked March 14)
    const completionDate = new Date("2026-03-12T10:00:00Z")
    const completionTime = completionDate.getTime()

    const testCases = [
      { date: "2026-03-12T00:00:00Z", shouldShow: false, day: "March 12 (completion day)" },
      { date: "2026-03-13T00:00:00Z", shouldShow: false, day: "March 13 (in the past)" },
      { date: "2026-03-14T00:00:00Z", shouldShow: false, day: "March 14 (today, but past show day)" },
    ]

    for (const testCase of testCases) {
      const testDate = new Date(testCase.date)
      const dayNum = dayOfDate(testDate)
      const isDue = isTaskDueOnDay(task, dayNum, completionTime, undefined, testDate)
      expect(isDue, `${testCase.day} should not show`).toBe(testCase.shouldShow)
    }
  })

  it("should validate that completed task appears only once", () => {
    const task: Task = {
      id: "task6",
      name: "Single Day Task",
      description: "",
      locationIds: [],
      schedule: {
        t: "interval",
        intervalInDays: 1,
      },
    }

    const completionDate = new Date("2026-03-14T10:00:00Z")
    const completionTime = completionDate.getTime()

    // Check many days around the completion
    const daysToCheck = Array.from({ length: 14 }, (_, i) => {
      const date = new Date("2026-03-08T00:00:00Z")
      date.setDate(date.getDate() + i)
      return date
    })

    const daysTaskIsShown = daysToCheck.filter((date) => {
      const dayNum = dayOfDate(date)
      return isTaskDueOnDay(task, dayNum, completionTime, undefined, date)
    })

    // Should appear on exactly one day
    expect(daysTaskIsShown, "Task should appear on exactly one day").toHaveLength(1)
    // That day should be March 15 (day after completion on March 14)
    expect(daysTaskIsShown[0].toISOString().split("T")[0]).toBe("2026-03-15")
  })

  it("should show uncompleted task only on today", () => {
    const task: Task = {
      id: "task7",
      name: "Uncompleted Task",
      description: "",
      locationIds: [],
      schedule: {
        t: "interval",
        intervalInDays: 1,
      },
    }

    // Never completed or snoozed
    const testCases = [
      { date: "2026-03-13T00:00:00Z", shouldShow: false, day: "March 13 (past)" },
      { date: "2026-03-14T00:00:00Z", shouldShow: true, day: "March 14 (today)" },
      { date: "2026-03-15T00:00:00Z", shouldShow: false, day: "March 15 (future)" },
      { date: "2026-03-16T00:00:00Z", shouldShow: false, day: "March 16 (future)" },
    ]

    for (const testCase of testCases) {
      const testDate = new Date(testCase.date)
      const dayNum = dayOfDate(testDate)
      const isDue = isTaskDueOnDay(task, dayNum, undefined, undefined, testDate)
      expect(isDue, `${testCase.day} should ${testCase.shouldShow ? "show" : "not show"}`).toBe(testCase.shouldShow)
    }
  })
})
