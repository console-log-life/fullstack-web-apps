/* =====================================================================
   TASK 3 - Project management tool frontend.

   Two screens: a list of projects, and a Kanban board.

   Drag-and-drop uses the native HTML5 API (draggable + dragstart /
   dragover / drop) - no library. The important details are:
     - dragstart must call dataTransfer.setData, or Firefox never fires drop
     - dragover must call preventDefault, or the browser refuses the drop
     - the drop index is worked out from the pointer position relative to the
       midpoint of each card, which is what makes "insert above/below" feel
       right

   The board also listens on the /projects Socket.io namespace, so a card
   moved in one tab moves in every other tab watching the same project.
   ===================================================================== */

const Projects = (() => {
  const STATUS_LABEL = { todo: 'To Do', in_progress: 'In Progress', done: 'Done' };
  const STATUS_ORDER = ['todo', 'in_progress', 'done'];

  /* ------------------------- project list page ------------------------- */

  async function renderList(root) {
    const host = el('div', { class: 'grid' });

    const newBtn = el('button', { class: 'btn', type: 'button' }, '+ New project');
    newBtn.addEventListener('click', () => openProjectForm(null, load));

    root.innerHTML = '';
    root.append(
      el('div', { class: 'page-head' },
        el('div', {},
          el('h1', { text: 'Projects' }),
          el('p', { class: 'muted', style: 'margin:0',
            text: 'Task 3 · group projects with a live Kanban board.' })),
        newBtn),
      host
    );

    async function load() {
      setLoading(host);
      try {
        const { projects } = await API.get('/api/projects');
        host.innerHTML = '';

        if (!projects.length) {
          host.classList.remove('grid');
          setEmpty(host, 'No projects yet. Create one and invite your teammates.', '\u{1F4CB}');
          return;
        }
        host.classList.add('grid');

        for (const project of projects) {
          const pct = project.task_count
            ? Math.round((project.done_count / project.task_count) * 100)
            : 0;

          host.append(
            el('article', { class: 'card project-card' },
              el('div', { class: 'row spread' },
                el('h3', { text: project.name }),
                el('span', {
                  class: `badge ${project.my_role === 'owner' ? 'badge-brand' : ''}`.trim(),
                  text: project.my_role,
                })),
              el('p', { class: 'desc', text: project.description || 'No description.' }),
              el('div', { class: 'small muted',
                text: `${project.member_count} member(s) · ${project.task_count} task(s) · ${pct}% done` }),
              el('div', { class: 'progress' }, el('span', { style: `width:${pct}%` })),
              el('a', { class: 'btn btn-sm', href: `/projects/board.html?project=${project.id}` },
                'Open board'))
          );
        }
      } catch (err) {
        host.classList.remove('grid');
        showError(host, err);
      }
    }

    load();
  }

  /** Create / rename modal. */
  function openProjectForm(project, onSaved) {
    const nameInput = el('input', { type: 'text', name: 'name', required: 'required', maxlength: '120',
      value: project?.name || '', placeholder: 'e.g. Website redesign' });
    const descInput = el('textarea', { name: 'description', maxlength: '1000',
      placeholder: 'What is this project about?' });
    descInput.value = project?.description || '';

    const feedback = el('div');
    const submit = el('button', { class: 'btn btn-block', type: 'submit' },
      project ? 'Save changes' : 'Create project');

    const form = el('form', { novalidate: 'novalidate' },
      el('div', { class: 'field' }, el('label', { text: 'Project name' }), nameInput),
      el('div', { class: 'field' }, el('label', { text: 'Description' }), descInput),
      feedback,
      submit);

    const close = openModal(project ? 'Edit project' : 'New project', form);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      feedback.innerHTML = '';
      const body = { name: nameInput.value.trim(), description: descInput.value.trim() };

      await withBusy(submit, async () => {
        try {
          const result = project
            ? await API.put(`/api/projects/${project.id}`, body)
            : await API.post('/api/projects', body);
          close();
          toastOk(result.message);
          onSaved(result.project);
        } catch (err) {
          showError(feedback, err);
        }
      });
    });
  }

  /* ----------------------------- board page ---------------------------- */

  async function renderBoard(root) {
    const projectId = Number(new URLSearchParams(location.search).get('project'));

    root.innerHTML = '';
    const host = el('div');
    root.append(host);

    if (!Number.isInteger(projectId) || projectId < 1) {
      showError(host, new Error('No project was selected.'));
      host.append(el('p', { style: 'margin-top:12px' },
        el('a', { href: '/projects/' }, '← Back to projects')));
      return;
    }

    setLoading(host);

    // Board state, kept in one object so socket events and local actions
    // update the same source of truth before a redraw.
    const state = { project: null, members: [], columns: {}, socket: null };

    try {
      const data = await API.get(`/api/projects/${projectId}`);
      state.project = data.project;
      state.members = data.members;
      state.columns = data.columns;
    } catch (err) {
      host.innerHTML = '';
      showError(host, err);
      host.append(el('p', { style: 'margin-top:12px' },
        el('a', { href: '/projects/' }, '← Back to projects')));
      return;
    }

    document.title = `${state.project.name} - CodeAlpha Projects`;

    const boardEl = el('div', { class: 'board' });
    const membersEl = el('div', { class: 'member-chips' });
    const livePill = el('div', { class: 'live-pill off' },
      el('span', { class: 'live-dot' }), el('span', { text: 'connecting…' }));
    const bannerHost = el('div');

    /* --- header --- */
    const addTaskBtn = el('button', { class: 'btn', type: 'button' }, '+ Add task');
    addTaskBtn.addEventListener('click', () => openTaskForm(null, 'todo'));

    const inviteBtn = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Add member');
    inviteBtn.addEventListener('click', openInvite);

    const headActions = el('div', { class: 'row row-wrap' }, addTaskBtn, inviteBtn);

    if (state.project.my_role === 'owner') {
      const editBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Edit');
      editBtn.addEventListener('click', () =>
        openProjectForm(state.project, (updated) => {
          state.project = { ...state.project, ...updated };
          location.reload();
        }));

      const delBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: 'color:var(--danger)' },
        'Delete project');
      delBtn.addEventListener('click', async () => {
        const yes = await confirmDialog('Delete project',
          `Delete "${state.project.name}" and all of its tasks? This cannot be undone.`,
          { confirmLabel: 'Delete project' });
        if (!yes) return;
        try {
          const { message } = await API.del(`/api/projects/${projectId}`);
          toastOk(message);
          location.href = '/projects/';
        } catch (err) {
          toastError(err.message);
        }
      });
      headActions.append(editBtn, delBtn);
    }

    host.innerHTML = '';
    host.append(
      el('p', { style: 'margin:0 0 12px' },
        el('a', { href: '/projects/' }, '← All projects')),
      el('div', { class: 'board-head' },
        el('div', {},
          el('div', { class: 'row row-wrap', style: 'gap:10px' },
            el('h1', { text: state.project.name, style: 'margin:0' }),
            livePill),
          state.project.description
            ? el('p', { class: 'muted', style: 'margin:6px 0 0;max-width:70ch',
                text: state.project.description })
            : null,
          el('div', { style: 'margin-top:10px' }, membersEl)),
        headActions),
      bannerHost,
      boardEl
    );

    /* --- a short-lived banner describing someone else's action --- */
    let bannerTimer = null;
    function liveBanner(text) {
      bannerHost.innerHTML = '';
      bannerHost.append(el('div', { class: 'live-banner', text }));
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { bannerHost.innerHTML = ''; }, 4500);
    }

    /* --- members --- */
    function paintMembers() {
      membersEl.innerHTML = '';
      for (const member of state.members) {
        const chip = el('span', { class: 'member-chip' },
          avatarNode(member, ''),
          el('span', { text: member.username }),
          member.role === 'owner' ? el('span', { class: 'badge', text: 'owner' }) : null);

        // The owner can remove anyone but themselves.
        if (state.project.my_role === 'owner' && member.role !== 'owner') {
          const remove = el('button', { type: 'button', title: `Remove ${member.username}` }, '×');
          remove.addEventListener('click', async () => {
            const yes = await confirmDialog('Remove member',
              `Remove ${member.username} from this project? Their tasks stay but become unassigned.`,
              { confirmLabel: 'Remove' });
            if (!yes) return;
            try {
              const { members, message } = await API.del(`/api/projects/${projectId}/members/${member.id}`);
              state.members = members;
              toastOk(message);
              paintMembers();
              await refreshBoard();
            } catch (err) {
              toastError(err.message);
            }
          });
          chip.append(remove);
        }
        membersEl.append(chip);
      }
    }

    function openInvite() {
      const input = el('input', { type: 'text', list: 'user-options', placeholder: 'username',
        required: 'required', autocomplete: 'off' });
      const options = el('datalist', { id: 'user-options' });
      const feedback = el('div');
      const submit = el('button', { class: 'btn btn-block', type: 'submit' }, 'Add to project');

      // Offer existing usernames, but a free-typed name works too.
      API.get('/api/auth/users')
        .then(({ users }) => {
          const existing = new Set(state.members.map((m) => m.username));
          users
            .filter((u) => !existing.has(u.username))
            .forEach((u) => options.append(el('option', { value: u.username })));
        })
        .catch(() => { /* the datalist is a convenience, not a requirement */ });

      const form = el('form', { novalidate: 'novalidate' },
        el('div', { class: 'field' },
          el('label', { text: 'Username' }), input, options,
          el('p', { class: 'small muted', style: 'margin:6px 0 0',
            text: 'They get a notification and can open the board straight away.' })),
        feedback,
        submit);

      const close = openModal('Add a member', form);

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        feedback.innerHTML = '';
        const username = input.value.trim();
        if (!username) return showError(feedback, new Error('Enter a username.'));

        await withBusy(submit, async () => {
          try {
            const { members, message } = await API.post(`/api/projects/${projectId}/members`, { username });
            state.members = members;
            close();
            toastOk(message);
            paintMembers();
          } catch (err) {
            showError(feedback, err);
          }
        });
      });
    }

    /* --------------------------- due dates --------------------------- */

    function dueBadge(dueDate, status) {
      if (!dueDate) return null;
      const due = new Date(`${dueDate}T00:00:00`);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const days = Math.round((due - today) / 86400000);

      // A done card is never "overdue" - the work is finished.
      let cls = 'due-ok';
      let label = formatDate(dueDate);
      if (status !== 'done') {
        if (days < 0) { cls = 'due-over'; label = `${Math.abs(days)}d overdue`; }
        else if (days === 0) { cls = 'due-soon'; label = 'Due today'; }
        else if (days <= 2) { cls = 'due-soon'; label = `Due in ${days}d`; }
      }
      return el('span', { class: `due ${cls}`, text: `\u{1F4C5} ${label}` });
    }

    /* --------------------------- drag state -------------------------- */

    // Which card is in flight, and where the drop marker currently sits.
    const drag = { taskId: null, fromStatus: null, marker: null };

    function clearMarker() {
      if (drag.marker) {
        drag.marker.remove();
        drag.marker = null;
      }
      $$('.column.drag-over').forEach((c) => c.classList.remove('drag-over'));
    }

    /**
     * Works out where a card dropped at clientY should be inserted, and shows
     * the marker there. Returns the index among the column's other cards.
     */
    function placeMarker(listEl, clientY) {
      const cards = Array.from(listEl.querySelectorAll('.task-card'))
        .filter((card) => card.dataset.taskId !== String(drag.taskId));

      if (!drag.marker) drag.marker = el('div', { class: 'drop-marker' });

      let index = cards.length;
      for (let i = 0; i < cards.length; i++) {
        const box = cards[i].getBoundingClientRect();
        // Above a card's midpoint means "insert before it".
        if (clientY < box.top + box.height / 2) {
          index = i;
          break;
        }
      }

      if (index < cards.length) cards[index].before(drag.marker);
      else listEl.append(drag.marker);

      return index;
    }

    /* ---------------------------- the board -------------------------- */

    function taskCard(task) {
      const card = el('article', {
        class: 'task-card',
        draggable: 'true',
        dataset: { taskId: String(task.id), status: task.status },
        tabindex: '0',
        role: 'button',
        'aria-label': `Task: ${task.title}`,
      },
        el('div', { class: 'task-title', text: task.title }),
        el('div', { class: 'task-meta' },
          task.assignee_username
            ? el('span', { class: 'task-assignee' },
                avatarNode({ username: task.assignee_username }, ''),
                task.assignee_username)
            : el('span', { class: 'badge', text: 'unassigned' }),
          dueBadge(task.due_date, task.status),
          task.comment_count > 0
            ? el('span', { class: 'muted', text: `\u{1F4AC} ${task.comment_count}` })
            : null));

      // Click (or Enter) opens the detail modal.
      card.addEventListener('click', () => openTaskDetail(task.id));
      card.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openTaskDetail(task.id);
        }
      });

      card.addEventListener('dragstart', (event) => {
        drag.taskId = task.id;
        drag.fromStatus = task.status;
        // Required: without setData, Firefox never fires a drop event.
        event.dataTransfer.setData('text/plain', String(task.id));
        event.dataTransfer.effectAllowed = 'move';
        // Defer the class so the drag image is the solid card, not a faded one.
        setTimeout(() => card.classList.add('dragging'), 0);
      });

      card.addEventListener('dragend', () => {
        card.classList.remove('dragging');
        clearMarker();
        drag.taskId = null;
      });

      return card;
    }

    function column(status) {
      const tasks = state.columns[status] || [];
      const list = el('div', { class: 'column-list', dataset: { status } });

      if (!tasks.length) {
        list.append(el('div', { class: 'column-empty', text: 'Drop a card here' }));
      } else {
        tasks.forEach((task) => list.append(taskCard(task)));
      }

      const add = el('button', { class: 'icon-btn', type: 'button', title: `Add a card to ${STATUS_LABEL[status]}` }, '+');
      add.addEventListener('click', () => openTaskForm(null, status));

      const col = el('section', { class: 'column', dataset: { status } },
        el('div', { class: 'column-head' },
          el('span', {}, STATUS_LABEL[status],
            el('span', { class: 'column-count', style: 'margin-left:7px', text: String(tasks.length) })),
          add),
        list);

      let dropIndex = 0;

      // preventDefault here is what makes the column a valid drop target.
      col.addEventListener('dragover', (event) => {
        if (drag.taskId === null) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
        col.classList.add('drag-over');
        const placeholder = list.querySelector('.column-empty');
        if (placeholder) placeholder.remove();
        dropIndex = placeMarker(list, event.clientY);
      });

      col.addEventListener('dragleave', (event) => {
        // Only clear when the pointer truly left the column, not a child.
        if (!col.contains(event.relatedTarget)) {
          col.classList.remove('drag-over');
        }
      });

      col.addEventListener('drop', async (event) => {
        event.preventDefault();
        const taskId = drag.taskId || Number(event.dataTransfer.getData('text/plain'));
        const fromStatus = drag.fromStatus;
        const index = dropIndex;
        clearMarker();
        if (!taskId) return;

        // Skip the request when the card was dropped exactly where it started.
        if (fromStatus === status) {
          const current = (state.columns[status] || []).findIndex((t) => t.id === taskId);
          if (current === index) return;
        }

        try {
          const { columns } = await API.patch(`/api/projects/tasks/${taskId}/move`,
            { status, position: index });
          state.columns = columns;
          paintBoard();
        } catch (err) {
          toastError(err.message);
          await refreshBoard(); // snap back to the server's version
        }
      });

      return col;
    }

    function paintBoard() {
      boardEl.innerHTML = '';
      STATUS_ORDER.forEach((status) => boardEl.append(column(status)));
    }

    async function refreshBoard() {
      try {
        const data = await API.get(`/api/projects/${projectId}`);
        state.project = data.project;
        state.members = data.members;
        state.columns = data.columns;
        paintMembers();
        paintBoard();
      } catch (err) {
        toastError(err.message);
      }
    }

    /* ------------------------- task create/edit ---------------------- */

    function openTaskForm(task, defaultStatus) {
      const titleInput = el('input', { type: 'text', maxlength: '200', required: 'required',
        value: task?.title || '', placeholder: 'What needs doing?' });
      const descInput = el('textarea', { maxlength: '2000', placeholder: 'Any details or acceptance criteria' });
      descInput.value = task?.description || '';

      const statusSelect = el('select', {},
        STATUS_ORDER.map((s) => el('option', { value: s }, STATUS_LABEL[s])));
      statusSelect.value = task?.status || defaultStatus || 'todo';

      const assigneeSelect = el('select', {}, el('option', { value: 'none' }, 'Unassigned'));
      for (const member of state.members) {
        assigneeSelect.append(el('option', { value: String(member.id) }, member.username));
      }
      assigneeSelect.value = task?.assignee_id ? String(task.assignee_id) : 'none';

      const dueInput = el('input', { type: 'date', value: task?.due_date || '' });

      const feedback = el('div');
      const submit = el('button', { class: 'btn btn-block', type: 'submit' },
        task ? 'Save task' : 'Create task');

      const form = el('form', { novalidate: 'novalidate' },
        el('div', { class: 'field' }, el('label', { text: 'Title' }), titleInput),
        el('div', { class: 'field' }, el('label', { text: 'Description' }), descInput),
        el('div', { class: 'field-row' },
          el('div', { class: 'field' }, el('label', { text: 'Column' }), statusSelect),
          el('div', { class: 'field' }, el('label', { text: 'Assignee' }), assigneeSelect)),
        el('div', { class: 'field' }, el('label', { text: 'Due date' }), dueInput),
        feedback,
        submit);

      const close = openModal(task ? 'Edit task' : 'New task', form);

      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        feedback.innerHTML = '';
        const body = {
          title: titleInput.value.trim(),
          description: descInput.value.trim(),
          status: statusSelect.value,
          assignee_id: assigneeSelect.value,
          due_date: dueInput.value || '',
        };

        await withBusy(submit, async () => {
          try {
            const result = task
              ? await API.put(`/api/projects/tasks/${task.id}`, body)
              : await API.post(`/api/projects/${projectId}/tasks`, body);
            close();
            toastOk(result.message);
            await refreshBoard();
          } catch (err) {
            showError(feedback, err);
          }
        });
      });
    }

    /* --------------------------- task detail -------------------------- */

    async function openTaskDetail(taskId) {
      const body = el('div');
      const close = openModal('Task', body);
      setLoading(body);

      let task;
      try {
        const data = await API.get(`/api/projects/tasks/${taskId}`);
        task = data.task;
      } catch (err) {
        return showError(body, err);
      }

      const commentsHost = el('div');

      function commentNode(comment) {
        const mine = Shell.user()?.id === comment.user_id;
        const del = el('button', { class: 'icon-btn', type: 'button', title: 'Delete comment' }, '×');
        del.addEventListener('click', async () => {
          try {
            await API.del(`/api/projects/comments/${comment.id}`);
            node.remove();
            if (!commentsHost.querySelector('.task-comment')) {
              commentsHost.append(el('p', { class: 'small muted', text: 'No comments yet.' }));
            }
            toastOk('Comment deleted.');
            await refreshBoard();
          } catch (err) {
            toastError(err.message);
          }
        });

        const node = el('div', { class: 'task-comment' },
          avatarNode(comment, 'avatar-sm'),
          el('div', { class: 'bubble' },
            el('div', { class: 'row spread' },
              el('span', { class: 'small',
                html: `<strong>${esc(comment.username)}</strong> <span class="muted">${esc(timeAgo(comment.created_at))}</span>` }),
              mine ? del : null),
            el('p', { text: comment.content })));
        return node;
      }

      function paintComments(list) {
        commentsHost.innerHTML = '';
        if (!list.length) {
          commentsHost.append(el('p', { class: 'small muted', text: 'No comments yet.' }));
          return;
        }
        list.forEach((c) => commentsHost.append(commentNode(c)));
      }

      paintComments(task.comments);

      /* comment form */
      const input = el('textarea', { placeholder: 'Add a comment…', maxlength: '1000' });
      const send = el('button', { class: 'btn btn-sm', type: 'submit' }, 'Comment');
      const commentForm = el('form', { class: 'row', style: 'align-items:flex-start;margin-top:10px' },
        el('div', { class: 'grow' }, input), send);

      commentForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        const content = input.value.trim();
        if (!content) return toastError('Write a comment first.');

        await withBusy(send, async () => {
          try {
            const { comment } = await API.post(`/api/projects/tasks/${taskId}/comments`, { content });
            input.value = '';
            const placeholder = commentsHost.querySelector('p.small.muted');
            if (placeholder) placeholder.remove();
            commentsHost.append(commentNode(comment));
            await refreshBoard();
          } catch (err) {
            toastError(err.message);
          }
        });
      });

      /* actions */
      const editBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Edit task');
      editBtn.addEventListener('click', () => {
        close();
        openTaskForm(task);
      });

      const delBtn = el('button', { class: 'btn btn-ghost btn-sm', type: 'button', style: 'color:var(--danger)' },
        'Delete task');
      delBtn.addEventListener('click', async () => {
        const yes = await confirmDialog('Delete task',
          `Delete "${task.title}"? Its comments go with it.`, { confirmLabel: 'Delete' });
        if (!yes) return;
        try {
          const { columns, message } = await API.del(`/api/projects/tasks/${taskId}`);
          state.columns = columns;
          close();
          toastOk(message);
          paintBoard();
        } catch (err) {
          toastError(err.message);
        }
      });

      body.innerHTML = '';
      body.append(
        el('h3', { text: task.title, style: 'margin-bottom:10px' }),
        el('div', { class: 'task-detail-meta' },
          el('div', {}, el('div', { class: 'label', text: 'Column' }),
            el('span', { class: 'badge badge-brand', text: STATUS_LABEL[task.status] })),
          el('div', {}, el('div', { class: 'label', text: 'Assignee' }),
            el('span', { text: task.assignee_username || 'Unassigned' })),
          el('div', {}, el('div', { class: 'label', text: 'Due' }),
            el('span', { text: task.due_date ? formatDate(task.due_date) : 'No due date' })),
          el('div', {}, el('div', { class: 'label', text: 'Created by' }),
            el('span', { text: `${task.creator_username} · ${timeAgo(task.created_at)}` }))),
        task.description
          ? el('p', { style: 'white-space:pre-wrap;word-break:break-word', text: task.description })
          : el('p', { class: 'muted small', text: 'No description.' }),
        el('div', { class: 'row', style: 'margin-top:12px' }, editBtn, delBtn),
        el('div', { class: 'task-comments' },
          el('h4', { text: 'Comments' }),
          commentsHost,
          commentForm)
      );
    }

    /* ----------------------- realtime (bonus) ------------------------ */

    function connectBoardSocket() {
      // Reuse the shared notification socket, so there is one connection for
      // both the bell and the board.
      const socket = Notifications.getSocket();
      if (!socket) {
        livePill.classList.add('off');
        livePill.lastChild.textContent = 'offline';
        return;
      }
      state.socket = socket;

      function markLive(on, label) {
        livePill.classList.toggle('off', !on);
        livePill.lastChild.textContent = label;
      }

      function joinBoard() {
        socket.emit('board:join', { project_id: projectId }, (ack) => {
          if (ack?.ok) markLive(true, 'live');
          else markLive(false, ack?.error || 'not live');
        });
      }

      if (socket.connected) joinBoard();
      socket.on('connect', joinBoard);
      socket.on('disconnect', () => markLive(false, 'reconnecting…'));
      socket.on('connect_error', () => markLive(false, 'offline'));

      /* --- board events from other members --- */

      socket.on('task:created', ({ task, actor }) => {
        if (task.project_id !== projectId) return;
        (state.columns[task.status] ||= []).push(task);
        paintBoard();
        liveBanner(`${actor} added "${task.title}"`);
      });

      socket.on('task:updated', ({ task, actor }) => {
        if (task.project_id !== projectId) return;
        // The card may have changed column, so refetch for a consistent board.
        refreshBoard().then(() => liveBanner(`${actor} updated "${task.title}"`));
      });

      socket.on('task:moved', ({ task, columns, actor }) => {
        if (task.project_id !== projectId) return;
        state.columns = columns;
        paintBoard();
        liveBanner(`${actor} moved "${task.title}" to ${STATUS_LABEL[task.status]}`);
      });

      socket.on('task:deleted', ({ columns, actor }) => {
        state.columns = columns;
        paintBoard();
        liveBanner(`${actor} deleted a task`);
      });

      socket.on('comment:created', ({ comment, task_id }) => {
        const task = Object.values(state.columns).flat().find((t) => t.id === task_id);
        if (task) {
          task.comment_count = (task.comment_count || 0) + 1;
          paintBoard();
        }
        liveBanner(`${comment.username} commented on a task`);
      });

      socket.on('comment:deleted', () => refreshBoard());

      socket.on('members:updated', ({ members }) => {
        state.members = members;
        paintMembers();
      });

      socket.on('board:refresh', () => refreshBoard());

      socket.on('project:updated', ({ project }) => {
        state.project = { ...state.project, ...project };
        liveBanner('The project details were updated');
      });

      socket.on('project:deleted', ({ project_id, name }) => {
        if (project_id !== projectId) return;
        toastError(`"${name}" was deleted by its owner.`);
        setTimeout(() => { location.href = '/projects/'; }, 1500);
      });

      socket.on('presence:joined', ({ username }) => liveBanner(`${username} opened this board`));

      // Tell the server when the tab closes, so presence stays accurate.
      window.addEventListener('beforeunload', () => {
        socket.emit('board:leave', { project_id: projectId });
      });
    }

    paintMembers();
    paintBoard();
    connectBoardSocket();
  }

  return { renderList, renderBoard };
})();

window.Projects = Projects;
