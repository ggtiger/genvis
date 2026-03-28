---
name: secretary-scheduler
displayName: Secretary Scheduler
description: Manage scheduled messages for the secretary. Use when user wants to view, create, modify, or delete scheduled tasks, or asks about "timed tasks" / "scheduled messages".
license: MIT
---

# Secretary Scheduler

Manage scheduled messages that the secretary will automatically send at specified intervals or times.

## Capabilities

- View all scheduled messages
- Create new scheduled messages
- Update existing scheduled messages
- Delete scheduled messages
- Trigger immediate execution

## Tools

### list_scheduled_messages

List all scheduled messages.

**Input**: None

**Returns**: Array of scheduled messages with their configurations.

**Example**:
```json
{}
```

### create_scheduled_message

Create a new scheduled message.

**Input**:
```json
{
  "content": "Check the daily report",
  "scheduleType": "interval",
  "intervalMinutes": 60,
  "aiReply": true,
  "enabled": true,
  "sendToIM": false
}
```

**Fields**:
- `content` (required): The message content to send
- `scheduleType`: "interval" (every N minutes) or "daily" (at specific time)
- `intervalMinutes`: For interval mode, how often to send (in minutes)
- `scheduledTime`: For daily mode, the time to send (HH:MM format, e.g., "09:00")
- `aiReply`: Whether AI should respond to this message (default: true)
- `enabled`: Whether this task is active (default: false)
- `sendToIM`: Whether to send the result to IM channel (default: false)

### update_scheduled_message

Update an existing scheduled message.

**Input**:
```json
{
  "id": "uuid-of-the-message",
  "content": "Updated content",
  "enabled": true
}
```

**Fields**: Same as create, plus `id` (required).

### delete_scheduled_message

Delete a scheduled message.

**Input**:
```json
{
  "id": "uuid-of-the-message"
}
```

### trigger_scheduled_message

Immediately execute a scheduled message.

**Input**:
```json
{
  "id": "uuid-of-the-message"
}
```

## Common Use Cases

### User asks: "What scheduled tasks do I have?"
Use `list_scheduled_messages` to show all tasks.

### User says: "Remind me to check email every hour"
Use `create_scheduled_message`:
```json
{
  "content": "Check email inbox",
  "scheduleType": "interval",
  "intervalMinutes": 60,
  "aiReply": false,
  "enabled": true
}
```

### User says: "Send me a daily summary at 9am"
Use `create_scheduled_message`:
```json
{
  "content": "Generate and send daily summary report",
  "scheduleType": "daily",
  "scheduledTime": "09:00",
  "aiReply": true,
  "enabled": true
}
```

### User says: "Disable the hourly reminder"
1. First use `list_scheduled_messages` to find the task ID
2. Then use `update_scheduled_message` with `enabled: false`

### User says: "Delete the old scheduled task"
1. First use `list_scheduled_messages` to find the task ID
2. Then use `delete_scheduled_message`
