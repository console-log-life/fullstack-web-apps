/**
 * CodeAlpha Task 3 - demo data seeder (`npm run seed`).
 *
 * Loads the four demo users and one project with all four of them as
 * members, ten tasks spread across the three columns, task comments and two
 * unread notifications so the bell shows a badge immediately.
 *
 * Re-running it is safe: it clears this task's tables and re-inserts them, so
 * you always get the same predictable starting state for a demo.
 */
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { db, migrate, DB_PATH } = require('./index');

migrate();

const PASSWORD = 'password123';

// The same four accounts in every task, so one set of credentials works
// everywhere in the submission.
const USERS = [
  { username: 'demo', email: 'demo@example.com' },
  { username: 'alice', email: 'alice@example.com' },
  { username: 'bob', email: 'bob@example.com' },
  { username: 'carol', email: 'carol@example.com' },
];

const TASKS = [
  ['Set up Express server and SQLite schema', 'Boot the server, run migrations on startup, add the health endpoint.', 'done', 'demo', -8],
  ['Shared auth: register, login, logout, me', 'bcrypt hashing plus JWT in an httpOnly cookie, with middleware protecting private routes.', 'done', 'demo', -6],
  ['Project list and membership checks', 'Only owners and members can open a board; a non-member gets a 404, not a 403.', 'done', 'alice', -4],
  ['Kanban drag and drop', 'Native HTML5 drag and drop that rewrites card positions on the server.', 'in_progress', 'bob', 2],
  ['Assignees and due dates', 'Restrict assignees to project members, style overdue and due-soon cards.', 'in_progress', 'alice', 3],
  ['Task comments', 'Threaded comments inside each card, deletable by their author.', 'in_progress', 'carol', 4],
  ['Live board sync over Socket.io', 'Broadcast card created, updated, moved and deleted to everyone on the board.', 'todo', 'bob', 6],
  ['Notification bell with unread count', 'Push notifications to a per-user room so they arrive on any page.', 'todo', 'demo', 7],
  ['Presence indicator', 'Show whether the board socket is connected, and who just opened the board.', 'todo', 'carol', 9],
  ['Write the README and record the demo', 'Setup steps, feature checklist, screenshots, demo script.', 'todo', 'demo', 11],
];

/** Returns a YYYY-MM-DD date `offset` days from today. */
function dateOffset(offset) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  return date.toISOString().slice(0, 10);
}

function run() {
  const passwordHash = bcrypt.hashSync(PASSWORD, 10);

  // Wrapped in a transaction: either the whole demo dataset lands or none of
  // it does, so a failure halfway through cannot leave a half-seeded database.
  const seedAll = db.transaction(() => {
    // Children first is only for readability; ON DELETE CASCADE handles it.
    for (const table of ['notifications', 'task_comments', 'tasks', 'project_members', 'projects', 'users']) {
      db.prepare(`DELETE FROM ${table}`).run();
    }
    // Restart AUTOINCREMENT so seeded ids are stable between runs.
    db.prepare("DELETE FROM sqlite_sequence WHERE name NOT IN ('')").run();

    // --- users -------------------------------------------------------
    const insertUser = db.prepare(
      'INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)'
    );
    const id = {}; // username -> id
    for (const user of USERS) {
      id[user.username] = Number(insertUser.run(user.username, user.email, passwordHash).lastInsertRowid);
    }

    // --- project + members -------------------------------------------
    const projectInfo = db
      .prepare('INSERT INTO projects (name, description, owner_id) VALUES (?, ?, ?)')
      .run(
        'CodeAlpha Internship Submission',
        'Ship all four full stack tasks: store, social app, project board and meeting room.',
        id.demo
      );
    const projectId = Number(projectInfo.lastInsertRowid);

    const insertMember = db.prepare(
      'INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)'
    );
    insertMember.run(projectId, id.demo, 'owner');
    for (const username of ['alice', 'bob', 'carol']) {
      insertMember.run(projectId, id[username], 'member');
    }

    // --- board -------------------------------------------------------
    const insertTask = db.prepare(
      `INSERT INTO tasks (project_id, title, description, status, assignee_id, due_date, position, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const positions = { todo: 0, in_progress: 0, done: 0 };
    const taskIds = [];
    for (const [title, description, status, assignee, dueOffset] of TASKS) {
      const info = insertTask.run(
        projectId, title, description, status,
        id[assignee], dateOffset(dueOffset),
        positions[status]++, id.demo
      );
      taskIds.push(Number(info.lastInsertRowid));
    }

    // --- task comments -----------------------------------------------
    const insertTaskComment = db.prepare(
      'INSERT INTO task_comments (task_id, user_id, content) VALUES (?, ?, ?)'
    );
    insertTaskComment.run(taskIds[3], id.demo, 'Rewrite the whole column order on a move, otherwise two cards can claim the same slot.');
    insertTaskComment.run(taskIds[3], id.alice, 'Remember preventDefault on dragover or the browser refuses the drop.');
    insertTaskComment.run(taskIds[6], id.bob, 'Board events go to project:<id>, notifications to user:<id>. Two different rooms.');
    insertTaskComment.run(taskIds[7], id.carol, 'The bell needs to work on every page, not just the board.');

    // Two unread notifications so the bell shows a badge immediately.
    const insertNotification = db.prepare(
      `INSERT INTO notifications (user_id, project_id, task_id, type, message, is_read)
       VALUES (?, ?, ?, ?, ?, 0)`
    );
    insertNotification.run(
      id.demo, projectId, taskIds[3], 'comment_added',
      'alice commented on "Kanban drag and drop"'
    );
    insertNotification.run(
      id.demo, projectId, taskIds[7], 'task_assigned',
      'alice assigned you "Notification bell with unread count"'
    );

    return id;
  });

  seedAll();

  console.log('\n  Seed complete.');
  console.log(`  Database : ${DB_PATH}`);
  console.log(`  Users    : ${USERS.map((u) => u.username).join(', ')}`);
  console.log(`  Password : ${PASSWORD}  (same for every demo user)`);
  console.log(`  Board    : 1 project, ${TASKS.length} tasks, 4 members`);
  console.log('  Comments : 4 task comments');
  console.log('  Bell     : 2 unread notifications for demo');
  console.log(`  Log in as "demo" / "${PASSWORD}" to start.\n`);
}

run();
