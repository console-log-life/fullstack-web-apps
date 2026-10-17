/**
 * TASK 3 - Project management tool (Trello-like) API.
 *
 *   GET    /api/projects                        projects I own or belong to
 *   POST   /api/projects                        create a project
 *   GET    /api/projects/:id                    project + members + board
 *   PUT    /api/projects/:id                    rename / re-describe (owner)
 *   DELETE /api/projects/:id                    delete (owner)
 *   POST   /api/projects/:id/members            add a member by username
 *   DELETE /api/projects/:id/members/:userId    remove a member (owner)
 *   POST   /api/projects/:id/tasks              create a card
 *   PUT    /api/projects/tasks/:taskId          edit a card
 *   PATCH  /api/projects/tasks/:taskId/move     drag-and-drop: new column + order
 *   DELETE /api/projects/tasks/:taskId          delete a card
 *   GET    /api/projects/tasks/:taskId          one card with its comments
 *   POST   /api/projects/tasks/:taskId/comments add a comment
 *   GET    /api/projects/notifications           bell list + unread count
 *   POST   /api/projects/notifications/read-all  clear the unread badge
 *
 * Every project route checks membership first: a project id alone is never
 * enough to read or change a board.
 *
 * Writes that other members should see immediately also emit Socket.io events
 * through the helpers injected by sockets/projects.js (see `realtime`).
 */
const express = require('express');

const { db } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired } = require('../middleware/auth');
const {
  ApiError,
  requireString,
  optionalString,
  requireInt,
  requireUsername,
  requireOneOf,
  optionalDate,
} = require('../utils/validate');

const router = express.Router();

const STATUSES = ['todo', 'in_progress', 'done'];
const STATUS_LABEL = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };

/**
 * Real-time hooks. sockets/projects.js replaces these at boot; until then they
 * are no-ops so the REST API works even with sockets disabled.
 */
const realtime = {
  emitBoard: () => {},     // (projectId, event, payload) -> everyone on that board
  emitNotify: () => {},    // (userId, notification)      -> that user's bell
};

/* --------------------------------------------------------------------
   Authorization helpers
   ------------------------------------------------------------------ */

/** Returns the project if the user is the owner or a member, else throws. */
function requireMembership(projectId, userId) {
  const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
  // 404 rather than 403 for a non-member, so project ids cannot be probed.
  if (!project) throw new ApiError(404, 'Project not found.');

  const member = db
    .prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
    .get(projectId, userId);

  if (!member && project.owner_id !== userId) {
    throw new ApiError(404, 'Project not found.');
  }

  project.my_role = project.owner_id === userId ? 'owner' : member?.role || 'member';
  return project;
}

function requireOwner(projectId, userId) {
  const project = requireMembership(projectId, userId);
  if (project.my_role !== 'owner') {
    throw new ApiError(403, 'Only the project owner can do that.');
  }
  return project;
}

/** Finds a task and checks the caller belongs to its project. */
function requireTaskAccess(taskId, userId) {
  const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!task) throw new ApiError(404, 'Task not found.');
  const project = requireMembership(task.project_id, userId);
  return { task, project };
}

/* --------------------------------------------------------------------
   Notifications
   ------------------------------------------------------------------ */

/**
 * Writes a notification and pushes it over Socket.io.
 * Never notifies the person who performed the action - being told about your
 * own click is noise.
 */
function notify({ userId, actorId, projectId, taskId, type, message }) {
  if (!userId || userId === actorId) return null;

  const info = db
    .prepare(
      `INSERT INTO notifications (user_id, project_id, task_id, type, message)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(userId, projectId || null, taskId || null, type, message);

  const row = db.prepare('SELECT * FROM notifications WHERE id = ?').get(Number(info.lastInsertRowid));
  realtime.emitNotify(userId, row);
  return row;
}

/** Notifies every member of a project except the actor. */
function notifyProject({ projectId, actorId, taskId, type, message }) {
  const members = db
    .prepare('SELECT user_id FROM project_members WHERE project_id = ? AND user_id <> ?')
    .all(projectId, actorId);
  for (const m of members) {
    notify({ userId: m.user_id, actorId, projectId, taskId, type, message });
  }
}

/* --------------------------------------------------------------------
   Board reading
   ------------------------------------------------------------------ */

const TASK_SELECT = `
  SELECT t.id, t.project_id, t.title, t.description, t.status, t.assignee_id,
         t.due_date, t.position, t.created_by, t.created_at,
         au.username AS assignee_username,
         cu.username AS creator_username,
         (SELECT COUNT(*) FROM task_comments tc WHERE tc.task_id = t.id) AS comment_count
    FROM tasks t
    LEFT JOIN users au ON au.id = t.assignee_id
    LEFT JOIN users cu ON cu.id = t.created_by
`;

function readMembers(projectId) {
  return db
    .prepare(
      `SELECT pm.user_id AS id, pm.role, u.username
         FROM project_members pm
         JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = ?
        ORDER BY pm.role = 'owner' DESC, u.username`
    )
    .all(projectId);
}

function readBoard(projectId) {
  const tasks = db
    .prepare(`${TASK_SELECT} WHERE t.project_id = ? ORDER BY t.status, t.position, t.id`)
    .all(projectId);

  // Grouped per column so the frontend can render straight into the three lists.
  const columns = { todo: [], in_progress: [], done: [] };
  for (const task of tasks) {
    (columns[task.status] || columns.todo).push(task);
  }
  return columns;
}

/* --------------------------------------------------------------------
   Notifications (bell)

   Declared BEFORE the "/:id" project routes on purpose. Express matches in
   declaration order, so with "/:id" first a GET of /notifications would be
   read as project id "notifications" and fail validation.
   ------------------------------------------------------------------ */

// GET /api/projects/notifications
router.get(
  '/notifications',
  authRequired,
  asyncHandler(async (req, res) => {
    const notifications = db
      .prepare(
        `SELECT * FROM notifications WHERE user_id = ?
          ORDER BY created_at DESC, id DESC LIMIT 30`
      )
      .all(req.user.id);

    const unread = db
      .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0')
      .get(req.user.id).n;

    res.json({ notifications, unread });
  })
);

// POST /api/projects/notifications/read-all
router.post(
  '/notifications/read-all',
  authRequired,
  asyncHandler(async (req, res) => {
    db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0')
      .run(req.user.id);
    res.json({ unread: 0, message: 'All notifications marked as read.' });
  })
);

// POST /api/projects/notifications/:id/read
router.post(
  '/notifications/:id/read',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'Notification id', { min: 1 });
    const info = db
      .prepare('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?')
      .run(id, req.user.id);
    if (info.changes === 0) throw new ApiError(404, 'Notification not found.');

    const unread = db
      .prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0')
      .get(req.user.id).n;
    res.json({ unread });
  })
);

/* --------------------------------------------------------------------
   Projects
   ------------------------------------------------------------------ */

// GET /api/projects
router.get(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const projects = db
      .prepare(
        `SELECT p.*, u.username AS owner_username,
                (SELECT COUNT(*) FROM project_members pm WHERE pm.project_id = p.id) AS member_count,
                (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) AS task_count,
                (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') AS done_count,
                CASE WHEN p.owner_id = ? THEN 'owner' ELSE 'member' END AS my_role
           FROM projects p
           JOIN users u ON u.id = p.owner_id
          WHERE p.owner_id = ?
             OR p.id IN (SELECT project_id FROM project_members WHERE user_id = ?)
          ORDER BY p.created_at DESC, p.id DESC`
      )
      .all(req.user.id, req.user.id, req.user.id);

    res.json({ projects });
  })
);

// POST /api/projects - the creator becomes the owner member.
router.post(
  '/',
  authRequired,
  asyncHandler(async (req, res) => {
    const name = requireString(req.body.name, 'Project name', { min: 2, max: 120 });
    const description = optionalString(req.body.description, 'Description', { max: 1000 });

    const create = db.transaction(() => {
      const info = db
        .prepare('INSERT INTO projects (name, description, owner_id) VALUES (?, ?, ?)')
        .run(name, description, req.user.id);
      const projectId = Number(info.lastInsertRowid);
      db.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'owner')")
        .run(projectId, req.user.id);
      return projectId;
    });

    const projectId = create();
    res.status(201).json({
      project: db.prepare('SELECT * FROM projects WHERE id = ?').get(projectId),
      message: 'Project created.',
    });
  })
);

// GET /api/projects/:id - everything the board page needs in one call.
router.get(
  '/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'Project id', { min: 1 });
    const project = requireMembership(id, req.user.id);
    const owner = db.prepare('SELECT username FROM users WHERE id = ?').get(project.owner_id);

    res.json({
      project: { ...project, owner_username: owner?.username || '' },
      members: readMembers(id),
      columns: readBoard(id),
      statuses: STATUSES.map((key) => ({ key, label: STATUS_LABEL[key] })),
    });
  })
);

// PUT /api/projects/:id
router.put(
  '/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'Project id', { min: 1 });
    requireOwner(id, req.user.id);

    const name = requireString(req.body.name, 'Project name', { min: 2, max: 120 });
    const description = optionalString(req.body.description, 'Description', { max: 1000 });

    db.prepare('UPDATE projects SET name = ?, description = ? WHERE id = ?')
      .run(name, description, id);

    const project = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    realtime.emitBoard(id, 'project:updated', { project });
    res.json({ project, message: 'Project updated.' });
  })
);

// DELETE /api/projects/:id
router.delete(
  '/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'Project id', { min: 1 });
    const project = requireOwner(id, req.user.id);

    // Members, tasks, comments and notifications cascade away.
    db.prepare('DELETE FROM projects WHERE id = ?').run(id);
    realtime.emitBoard(id, 'project:deleted', { project_id: id, name: project.name });
    res.json({ message: `Project "${project.name}" deleted.` });
  })
);

/* --------------------------------------------------------------------
   Members
   ------------------------------------------------------------------ */

// POST /api/projects/:id/members  { username }
router.post(
  '/:id/members',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'Project id', { min: 1 });
    const project = requireMembership(id, req.user.id);
    const username = requireUsername(req.body.username);

    const user = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
    if (!user) throw new ApiError(404, `No user called "${username}".`);

    const already = db
      .prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?')
      .get(id, user.id);
    if (already) throw new ApiError(409, `${user.username} is already a member.`);

    db.prepare("INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, 'member')")
      .run(id, user.id);

    notify({
      userId: user.id,
      actorId: req.user.id,
      projectId: id,
      type: 'project_invite',
      message: `${req.user.username} added you to "${project.name}"`,
    });

    const members = readMembers(id);
    realtime.emitBoard(id, 'members:updated', { members });
    res.status(201).json({ members, message: `${user.username} added to the project.` });
  })
);

// DELETE /api/projects/:id/members/:userId
router.delete(
  '/:id/members/:userId',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'Project id', { min: 1 });
    const userId = requireInt(req.params.userId, 'User id', { min: 1 });
    const project = requireOwner(id, req.user.id);

    if (userId === project.owner_id) {
      throw new ApiError(400, 'The project owner cannot be removed.');
    }

    const info = db
      .prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?')
      .run(id, userId);
    if (info.changes === 0) throw new ApiError(404, 'That person is not a member.');

    // Their assigned cards stay on the board but become unassigned.
    db.prepare('UPDATE tasks SET assignee_id = NULL WHERE project_id = ? AND assignee_id = ?')
      .run(id, userId);

    const members = readMembers(id);
    realtime.emitBoard(id, 'members:updated', { members });
    realtime.emitBoard(id, 'board:refresh', {});
    res.json({ members, message: 'Member removed.' });
  })
);

/* --------------------------------------------------------------------
   Tasks (cards)
   ------------------------------------------------------------------ */

/** Validates that an assignee, if given, actually belongs to the project. */
function resolveAssignee(projectId, rawValue) {
  if (rawValue === undefined || rawValue === null || rawValue === '' || rawValue === 'none') {
    return null;
  }
  const assigneeId = requireInt(rawValue, 'Assignee', { min: 1 });
  const isMember = db
    .prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?')
    .get(projectId, assigneeId);
  if (!isMember) throw new ApiError(400, 'You can only assign tasks to project members.');
  return assigneeId;
}

// POST /api/projects/:id/tasks
router.post(
  '/:id/tasks',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'Project id', { min: 1 });
    const project = requireMembership(id, req.user.id);

    const title = requireString(req.body.title, 'Task title', { min: 2, max: 200 });
    const description = optionalString(req.body.description, 'Description', { max: 2000 });
    const status = requireOneOf(req.body.status || 'todo', 'Status', STATUSES);
    const dueDate = optionalDate(req.body.due_date, 'Due date');
    const assigneeId = resolveAssignee(id, req.body.assignee_id);

    // New cards go to the bottom of their column.
    const next = db
      .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM tasks WHERE project_id = ? AND status = ?')
      .get(id, status).pos;

    const info = db
      .prepare(
        `INSERT INTO tasks (project_id, title, description, status, assignee_id, due_date, position, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(id, title, description, status, assigneeId, dueDate, next, req.user.id);

    const task = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(Number(info.lastInsertRowid));

    realtime.emitBoard(id, 'task:created', { task, actor: req.user.username });

    if (assigneeId) {
      notify({
        userId: assigneeId,
        actorId: req.user.id,
        projectId: id,
        taskId: task.id,
        type: 'task_assigned',
        message: `${req.user.username} assigned you "${task.title}" in ${project.name}`,
      });
    }

    res.status(201).json({ task, message: 'Task created.' });
  })
);

// GET /api/projects/tasks/:taskId
router.get(
  '/tasks/:taskId',
  authRequired,
  asyncHandler(async (req, res) => {
    const taskId = requireInt(req.params.taskId, 'Task id', { min: 1 });
    requireTaskAccess(taskId, req.user.id);

    const task = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(taskId);
    task.comments = db
      .prepare(
        `SELECT tc.id, tc.content, tc.created_at, tc.user_id, u.username
           FROM task_comments tc
           JOIN users u ON u.id = tc.user_id
          WHERE tc.task_id = ?
          ORDER BY tc.created_at ASC, tc.id ASC`
      )
      .all(taskId);

    res.json({ task, members: readMembers(task.project_id) });
  })
);

// PUT /api/projects/tasks/:taskId
router.put(
  '/tasks/:taskId',
  authRequired,
  asyncHandler(async (req, res) => {
    const taskId = requireInt(req.params.taskId, 'Task id', { min: 1 });
    const { task: existing, project } = requireTaskAccess(taskId, req.user.id);

    const title = requireString(req.body.title, 'Task title', { min: 2, max: 200 });
    const description = optionalString(req.body.description, 'Description', { max: 2000 });
    const dueDate = optionalDate(req.body.due_date, 'Due date');
    const assigneeId = resolveAssignee(existing.project_id, req.body.assignee_id);
    const status = requireOneOf(req.body.status || existing.status, 'Status', STATUSES);

    // Moving column through the edit form needs a position in the new column.
    let position = existing.position;
    if (status !== existing.status) {
      position = db
        .prepare('SELECT COALESCE(MAX(position), -1) + 1 AS pos FROM tasks WHERE project_id = ? AND status = ?')
        .get(existing.project_id, status).pos;
    }

    db.prepare(
      `UPDATE tasks
          SET title = ?, description = ?, status = ?, assignee_id = ?, due_date = ?, position = ?
        WHERE id = ?`
    ).run(title, description, status, assigneeId, dueDate, position, taskId);

    const task = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(taskId);
    realtime.emitBoard(existing.project_id, 'task:updated', { task, actor: req.user.username });

    // Only tell the assignee when the assignment actually changed.
    if (assigneeId && assigneeId !== existing.assignee_id) {
      notify({
        userId: assigneeId,
        actorId: req.user.id,
        projectId: existing.project_id,
        taskId,
        type: 'task_assigned',
        message: `${req.user.username} assigned you "${task.title}" in ${project.name}`,
      });
    }

    res.json({ task, message: 'Task updated.' });
  })
);

// PATCH /api/projects/tasks/:taskId/move  { status, position }
// This is the drag-and-drop endpoint: it both moves a card between columns and
// reorders cards inside one.
router.patch(
  '/tasks/:taskId/move',
  authRequired,
  asyncHandler(async (req, res) => {
    const taskId = requireInt(req.params.taskId, 'Task id', { min: 1 });
    const { task: existing, project } = requireTaskAccess(taskId, req.user.id);

    const status = requireOneOf(req.body.status, 'Status', STATUSES);
    const requested = requireInt(req.body.position ?? 0, 'Position', { min: 0, max: 10000 });

    /**
     * Positions are rewritten rather than patched: pull the column's cards in
     * order, splice the dragged card in at the requested index, then write
     * 0..n-1 back. One transaction, so the board can never be left with two
     * cards claiming the same slot.
     */
    const move = db.transaction(() => {
      const sameColumn = existing.status === status;

      const siblings = db
        .prepare(
          `SELECT id FROM tasks
            WHERE project_id = ? AND status = ? AND id <> ?
            ORDER BY position, id`
        )
        .all(existing.project_id, status, taskId)
        .map((row) => row.id);

      const index = Math.min(requested, siblings.length);
      siblings.splice(index, 0, taskId);

      const setPos = db.prepare('UPDATE tasks SET position = ?, status = ? WHERE id = ?');
      siblings.forEach((id, i) => setPos.run(i, status, id));

      // If the card left a column, close the gap it left behind.
      if (!sameColumn) {
        const old = db
          .prepare('SELECT id FROM tasks WHERE project_id = ? AND status = ? ORDER BY position, id')
          .all(existing.project_id, existing.status)
          .map((row) => row.id);
        old.forEach((id, i) => db.prepare('UPDATE tasks SET position = ? WHERE id = ?').run(i, id));
      }

      return { movedColumn: !sameColumn };
    });

    const { movedColumn } = move();

    const task = db.prepare(`${TASK_SELECT} WHERE t.id = ?`).get(taskId);
    const columns = readBoard(existing.project_id);

    // Everyone on the board redraws from the authoritative column order.
    realtime.emitBoard(existing.project_id, 'task:moved', {
      task, columns, actor: req.user.username,
    });

    // A reorder inside one column is not worth a notification; a column change is.
    if (movedColumn) {
      notifyProject({
        projectId: existing.project_id,
        actorId: req.user.id,
        taskId,
        type: 'card_moved',
        message: `${req.user.username} moved "${task.title}" to ${STATUS_LABEL[status]} in ${project.name}`,
      });
    }

    res.json({ task, columns, message: 'Task moved.' });
  })
);

// DELETE /api/projects/tasks/:taskId
router.delete(
  '/tasks/:taskId',
  authRequired,
  asyncHandler(async (req, res) => {
    const taskId = requireInt(req.params.taskId, 'Task id', { min: 1 });
    const { task } = requireTaskAccess(taskId, req.user.id);

    db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);

    const columns = readBoard(task.project_id);
    realtime.emitBoard(task.project_id, 'task:deleted', {
      task_id: taskId, columns, actor: req.user.username,
    });

    res.json({ columns, message: 'Task deleted.' });
  })
);

/* --------------------------------------------------------------------
   Task comments
   ------------------------------------------------------------------ */

// POST /api/projects/tasks/:taskId/comments
router.post(
  '/tasks/:taskId/comments',
  authRequired,
  asyncHandler(async (req, res) => {
    const taskId = requireInt(req.params.taskId, 'Task id', { min: 1 });
    const { task, project } = requireTaskAccess(taskId, req.user.id);
    const content = requireString(req.body.content, 'Comment', { min: 1, max: 1000 });

    const info = db
      .prepare('INSERT INTO task_comments (task_id, user_id, content) VALUES (?, ?, ?)')
      .run(taskId, req.user.id, content);

    const comment = db
      .prepare(
        `SELECT tc.id, tc.content, tc.created_at, tc.user_id, u.username
           FROM task_comments tc
           JOIN users u ON u.id = tc.user_id
          WHERE tc.id = ?`
      )
      .get(Number(info.lastInsertRowid));

    const commentCount = db
      .prepare('SELECT COUNT(*) AS n FROM task_comments WHERE task_id = ?')
      .get(taskId).n;

    realtime.emitBoard(task.project_id, 'comment:created', {
      task_id: taskId, comment, comment_count: commentCount,
    });

    // The assignee hears about it directly; everyone else gets the board event.
    notify({
      userId: task.assignee_id,
      actorId: req.user.id,
      projectId: task.project_id,
      taskId,
      type: 'comment_added',
      message: `${req.user.username} commented on "${task.title}" in ${project.name}`,
    });

    res.status(201).json({ comment, comment_count: commentCount });
  })
);

// DELETE /api/projects/comments/:commentId
router.delete(
  '/comments/:commentId',
  authRequired,
  asyncHandler(async (req, res) => {
    const commentId = requireInt(req.params.commentId, 'Comment id', { min: 1 });
    const row = db
      .prepare('SELECT tc.*, t.project_id FROM task_comments tc JOIN tasks t ON t.id = tc.task_id WHERE tc.id = ?')
      .get(commentId);
    if (!row) throw new ApiError(404, 'Comment not found.');

    requireMembership(row.project_id, req.user.id);
    if (row.user_id !== req.user.id) {
      throw new ApiError(403, 'You can only delete your own comments.');
    }

    db.prepare('DELETE FROM task_comments WHERE id = ?').run(commentId);
    const commentCount = db
      .prepare('SELECT COUNT(*) AS n FROM task_comments WHERE task_id = ?')
      .get(row.task_id).n;

    realtime.emitBoard(row.project_id, 'comment:deleted', {
      task_id: row.task_id, comment_id: commentId, comment_count: commentCount,
    });

    res.json({ message: 'Comment deleted.', comment_count: commentCount });
  })
);

module.exports = router;
// Shared with sockets/projects.js so socket handlers can reuse the same
// membership checks and notification writer.
module.exports.realtime = realtime;
module.exports.requireMembership = requireMembership;
module.exports.readBoard = readBoard;
module.exports.STATUSES = STATUSES;
