# 📋 Recurring Task Planner – Requirements

## 1. Application Overview

- A **mobile-only Progressive Web App (PWA)** for managing recurring tasks.
- Tasks can repeat on:
  - **Interval basis** (e.g., every day, every 2 days).
  - **Weekly basis** (specific days of the week).
  - **Monthly basis** (specific day of the month, up to day 28).

## 2. Locations

- Each task is linked to one or more **locations** (e.g., apartment, gym, workplace).
- Users can **add, edit, and delete locations**.

## 3. Tasks

- Users can **add, edit, and delete tasks**.
- Each task appears as a **full-width row** on the home screen.
- Task interactions:
  - **Swipe right** → mark as completed.
  - **Swipe left** → snooze.
  - **Tap** → open task details (with options to edit or delete).

## 4. Home Screen

- Displays **tasks scheduled for the current day**.
- Includes:
  - **Dropdown** to filter tasks by location (or show all).
  - **Date picker** to view tasks on future dates.
  - **Undo button** (stores up to 10 past states; disabled when no actions remain).
  - **Buttons at the top**:
    - Add new task.
    - Manage locations.

## 5. Task Scheduling Rules

- A task is considered **future** if:
  - It is a monthly task.
  - It is a weekly task.
  - It is an interval task that was snoozed.
- **Snoozing behavior**:
  - Users can snooze tasks manually.
  - Missed tasks are automatically snoozed.
  - Snoozed tasks reappear the next day.
- **Day start time**: 2:00 AM.
- **Task ordering**:
  - Snoozed tasks appear first.
  - Older snoozed tasks appear before newer ones.
  - Users can manually reorder tasks for the current day.

## 6. Data Storage

- All data is stored in **localStorage**:
  - Tasks.
  - Locations.
  - Current task order.
- **Validation**:
  - Data is parsed with **Zod**.
  - If no data exists, initial sample data is created.
  - If data is invalid:
    - It is pruned until it matches the schema.
    - User sees an error screen explaining what was removed.
    - User must click **“Continue”** to save the pruned data back to localStorage.

## 7. State Management

- Functional programming approach.
- Maintain an **array of state history** for undo functionality (up to 10 actions).
