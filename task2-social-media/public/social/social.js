/* =====================================================================
   TASK 2 - Social media platform frontend.

   Three screens: the home feed (people you follow + yourself), explore
   (everything), and a profile page. The post card is one shared builder
   so a post looks and behaves identically wherever it appears.
   ===================================================================== */

const Social = (() => {
  const MAX_POST = 2000;

  /* ---------------------------- sub-nav ---------------------------- */

  function tabs(active) {
    const me = Shell.user();
    return el(
      'div',
      { class: 'social-tabs' },
      el('a', { href: '/social/', class: active === 'feed' ? 'active' : '' }, 'Home feed'),
      el('a', { href: '/social/explore.html', class: active === 'explore' ? 'active' : '' }, 'Explore'),
      me
        ? el('a', {
            href: `/social/profile.html?u=${encodeURIComponent(me.username)}`,
            class: active === 'profile' ? 'active' : '',
          }, 'My profile')
        : null
    );
  }

  /** Links a username to its profile page. */
  function profileLink(user, className = 'post-author') {
    return el('a', {
      class: className,
      href: `/social/profile.html?u=${encodeURIComponent(user.username)}`,
      text: user.display_name || user.username,
    });
  }

  /* --------------------- image picker (shared) --------------------- */

  /**
   * A "choose image" control with a live preview and a remove button.
   * Returns { node, getFile, isRemoved, reset }.
   */
  function imagePicker(existingUrl = '') {
    const input = el('input', { type: 'file', accept: 'image/*', name: 'image' });
    const preview = el('div', { class: 'image-preview hidden' });
    let removed = false;

    function showPreview(src) {
      preview.innerHTML = '';
      const clear = el('button', { type: 'button' }, 'Remove image');
      clear.addEventListener('click', () => {
        input.value = '';
        removed = true;
        preview.classList.add('hidden');
        preview.innerHTML = '';
      });
      preview.append(el('img', { src, alt: 'Selected image preview' }), clear);
      preview.classList.remove('hidden');
    }

    if (existingUrl) showPreview(existingUrl);

    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) return;
      // Checked here too, so the user is told before a 5MB upload is attempted.
      if (file.size > 5 * 1024 * 1024) {
        toastError('Please choose an image under 5MB.');
        input.value = '';
        return;
      }
      removed = false;
      showPreview(URL.createObjectURL(file));
    });

    const node = el(
      'div',
      {},
      el('label', { class: 'file-pick' }, '\u{1F5BC} Add image', input),
      preview
    );

    return {
      node,
      getFile: () => input.files?.[0] || null,
      isRemoved: () => removed,
      reset: () => {
        input.value = '';
        removed = false;
        preview.classList.add('hidden');
        preview.innerHTML = '';
      },
    };
  }

  /* ---------------------------- composer --------------------------- */

  /** The "what's on your mind" card. onPosted receives the new post. */
  function composer(onPosted) {
    const textarea = el('textarea', {
      name: 'content', placeholder: "What's on your mind?", maxlength: String(MAX_POST),
      'aria-label': 'Post text',
    });
    const counter = el('span', { class: 'composer-count', text: `0 / ${MAX_POST}` });
    const picker = imagePicker();
    const submit = el('button', { class: 'btn', type: 'submit', disabled: 'disabled' }, 'Post');
    const feedback = el('div');

    textarea.addEventListener('input', () => {
      const len = textarea.value.trim().length;
      counter.textContent = `${len} / ${MAX_POST}`;
      counter.classList.toggle('over', len > MAX_POST);
      submit.disabled = len === 0 || len > MAX_POST;
    });

    const form = el(
      'form',
      { class: 'card composer', novalidate: 'novalidate' },
      el('div', { class: 'row', style: 'align-items:flex-start;gap:11px' },
        avatarNode(Shell.user(), 'avatar-sm'),
        el('div', { class: 'grow' }, textarea)),
      picker.node,
      feedback,
      el('div', { class: 'composer-foot' }, counter, submit)
    );

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      feedback.innerHTML = '';
      const content = textarea.value.trim();
      if (!content) return;

      // FormData, because a post may carry an image file.
      const data = new FormData();
      data.set('content', content);
      const file = picker.getFile();
      if (file) data.set('image', file);

      await withBusy(submit, async () => {
        try {
          const { post } = await API.upload('/api/social/posts', data);
          textarea.value = '';
          counter.textContent = `0 / ${MAX_POST}`;
          submit.disabled = true;
          picker.reset();
          toastOk('Post published.');
          onPosted(post);
        } catch (err) {
          showError(feedback, err);
        }
      });
    });

    return form;
  }

  /* --------------------------- post card --------------------------- */

  /**
   * Builds one post card: text, optional image, like / comment / edit /
   * delete. `onRemoved` lets the caller drop the card from its list.
   */
  function postCard(post, { onRemoved } = {}) {
    const me = Shell.user();
    const isMine = me && me.id === post.user_id;

    const card = el('article', { class: 'card post', dataset: { postId: String(post.id) } });

    /* --- like button --- */
    const likeBtn = el('button', {
      class: `icon-btn ${post.liked_by_me ? 'liked' : ''}`.trim(), type: 'button',
    }, `${post.liked_by_me ? '♥' : '♡'} ${post.like_count}`);

    likeBtn.addEventListener('click', async () => {
      if (!me) {
        toast('Please log in to like posts.', 'info');
        return Shell.promptLogin();
      }
      likeBtn.disabled = true;
      try {
        const { liked, like_count } = await API.post(`/api/social/posts/${post.id}/like`);
        likeBtn.classList.toggle('liked', liked);
        likeBtn.textContent = `${liked ? '♥' : '♡'} ${like_count}`;
      } catch (err) {
        toastError(err.message);
      } finally {
        likeBtn.disabled = false;
      }
    });

    /* --- comments --- */
    const commentsBox = el('div', { class: 'comments hidden' });
    let commentsLoaded = false;

    const commentBtn = el('button', { class: 'icon-btn', type: 'button' },
      `\u{1F4AC} ${post.comment_count}`);

    function setCommentCount(n) {
      commentBtn.textContent = `\u{1F4AC} ${n}`;
    }

    function commentNode(comment) {
      const canDelete = me && (me.id === comment.user_id || me.id === post.user_id);
      const del = el('button', { class: 'icon-btn', type: 'button', title: 'Delete comment' }, '×');
      del.addEventListener('click', async () => {
        try {
          const { comment_count } = await API.del(`/api/social/comments/${comment.id}`);
          node.remove();
          setCommentCount(comment_count);
          toastOk('Comment deleted.');
        } catch (err) {
          toastError(err.message);
        }
      });

      const node = el(
        'div',
        { class: 'comment' },
        avatarNode(comment, 'avatar-sm'),
        el('div', { class: 'comment-bubble' },
          el('div', { class: 'row spread' },
            el('div', {},
              profileLink(comment, 'post-author'),
              el('span', { class: 'post-time', text: ` · ${timeAgo(comment.created_at)}` })),
            canDelete ? del : null),
          el('div', { class: 'comment-text', text: comment.content }))
      );
      return node;
    }

    async function loadComments() {
      if (commentsLoaded) return;
      const list = el('div');
      commentsBox.innerHTML = '';
      commentsBox.append(list);
      setLoading(list);

      try {
        const { comments } = await API.get(`/api/social/posts/${post.id}/comments`);
        list.innerHTML = '';
        if (!comments.length) {
          list.append(el('p', { class: 'small muted', text: 'No comments yet. Be the first.' }));
        } else {
          comments.forEach((c) => list.append(commentNode(c)));
        }

        // Only signed-in users get the comment box.
        if (me) {
          const input = el('textarea', {
            placeholder: 'Write a comment…', maxlength: '1000', 'aria-label': 'Write a comment',
          });
          const send = el('button', { class: 'btn btn-sm', type: 'submit' }, 'Send');
          const form = el('form', { class: 'comment-form', novalidate: 'novalidate' },
            avatarNode(me, 'avatar-sm'), el('div', { class: 'grow' }, input), send);

          form.addEventListener('submit', async (event) => {
            event.preventDefault();
            const content = input.value.trim();
            if (!content) return toastError('Write something first.');

            await withBusy(send, async () => {
              try {
                const { comment, comment_count } = await API.post(
                  `/api/social/posts/${post.id}/comments`, { content }
                );
                input.value = '';
                // Replace the "no comments yet" line on the first comment.
                const placeholder = list.querySelector('p.small.muted');
                if (placeholder) placeholder.remove();
                list.append(commentNode(comment));
                setCommentCount(comment_count);
              } catch (err) {
                toastError(err.message);
              }
            });
          });

          commentsBox.append(form);
        } else {
          commentsBox.append(el('p', { class: 'small muted', text: 'Log in to join the conversation.' }));
        }

        commentsLoaded = true;
      } catch (err) {
        showError(list, err);
      }
    }

    commentBtn.addEventListener('click', async () => {
      const wasHidden = commentsBox.classList.contains('hidden');
      commentsBox.classList.toggle('hidden');
      if (wasHidden) await loadComments();
    });

    /* --- edit / delete (author only) --- */
    const menu = el('div', { class: 'post-menu' });
    if (isMine) {
      const editBtn = el('button', { class: 'icon-btn', type: 'button' }, 'Edit');
      editBtn.addEventListener('click', () => openEditor(post, card, { onRemoved }));
      const delBtn = el('button', { class: 'icon-btn', type: 'button', style: 'color:var(--danger)' }, 'Delete');
      delBtn.addEventListener('click', async () => {
        const yes = await confirmDialog('Delete post',
          'Delete this post? Its likes and comments go with it.', { confirmLabel: 'Delete' });
        if (!yes) return;
        try {
          await API.del(`/api/social/posts/${post.id}`);
          toastOk('Post deleted.');
          card.remove();
          if (onRemoved) onRemoved(post.id);
        } catch (err) {
          toastError(err.message);
        }
      });
      menu.append(editBtn, delBtn);
    }

    const edited = post.updated_at && post.updated_at !== post.created_at;

    card.append(
      el('div', { class: 'post-head' },
        avatarNode(post),
        el('div', { class: 'grow' },
          profileLink(post),
          el('div', { class: 'post-time' },
            `@${post.username} · ${timeAgo(post.created_at)}${edited ? ' · edited' : ''}`)),
        menu),
      el('div', { class: 'post-content', text: post.content }),
      post.image_url
        ? el('img', { class: 'post-image', src: post.image_url, alt: 'Post image', loading: 'lazy' })
        : null,
      el('div', { class: 'post-actions' }, likeBtn, commentBtn),
      commentsBox
    );

    return card;
  }

  /** Edit modal; swaps the card in place for the updated one on success. */
  function openEditor(post, card, opts) {
    const textarea = el('textarea', { name: 'content', maxlength: String(MAX_POST) });
    textarea.value = post.content;
    const picker = imagePicker(post.image_url);
    const feedback = el('div');
    const submit = el('button', { class: 'btn btn-block', type: 'submit' }, 'Save changes');

    const form = el('form', { novalidate: 'novalidate' },
      el('div', { class: 'field' }, el('label', { text: 'Post text' }), textarea),
      picker.node,
      el('div', { style: 'height:14px' }),
      feedback,
      submit);

    const close = openModal('Edit post', form);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      feedback.innerHTML = '';
      const content = textarea.value.trim();
      if (!content) return showError(feedback, new Error('A post needs some text.'));

      const data = new FormData();
      data.set('content', content);
      const file = picker.getFile();
      if (file) data.set('image', file);
      // Tells the server to clear an existing image the user removed.
      else if (picker.isRemoved()) data.set('remove_image', 'true');

      await withBusy(submit, async () => {
        try {
          const { post: updated } = await API.upload(`/api/social/posts/${post.id}`, data, 'PUT');
          close();
          toastOk('Post updated.');
          card.replaceWith(postCard(updated, opts));
        } catch (err) {
          showError(feedback, err);
        }
      });
    });
  }

  /* ------------------------- suggestions side ------------------------- */

  function suggestionsCard() {
    const host = el('div', { class: 'card' }, el('h3', { text: 'People to follow' }));
    const list = el('div');
    host.append(list);
    setLoading(list);

    API.get('/api/social/suggestions')
      .then(({ users }) => {
        list.innerHTML = '';
        if (!users.length) {
          list.append(el('p', { class: 'small muted', text: 'You already follow everyone here.' }));
          return;
        }
        for (const user of users) {
          const btn = el('button', { class: 'btn btn-sm btn-ghost', type: 'button' }, 'Follow');
          btn.addEventListener('click', async () => {
            await withBusy(btn, async () => {
              try {
                const { following, message } = await API.post(
                  `/api/social/users/${encodeURIComponent(user.username)}/follow`
                );
                toastOk(message);
                // Stays clickable so the row doubles as an unfollow control.
                btn.textContent = following ? 'Unfollow' : 'Follow';
              } catch (err) {
                toastError(err.message);
              }
            });
          });

          list.append(
            el('div', { class: 'user-row' },
              avatarNode(user, 'avatar-sm'),
              el('div', { class: 'grow' },
                profileLink(user, 'username'),
                el('span', { class: 'handle', text: `${user.follower_count} follower(s)` })),
              btn)
          );
        }
      })
      .catch((err) => showError(list, err));

    return host;
  }

  /* ----------------------------- feed page ----------------------------- */

  async function renderFeed(root) {
    const feedHost = el('div');
    const side = el('aside', { class: 'social-side' }, suggestionsCard());

    root.innerHTML = '';
    root.append(
      el('div', { class: 'page-head' },
        el('div', {},
          el('h1', { text: 'Home feed' }),
          el('p', { class: 'muted', style: 'margin:0',
            text: 'Task 2 · posts from the people you follow, and your own.' }))),
      tabs('feed'),
      el('div', { class: 'social-layout' }, el('div', {}, composer(onPosted), feedHost), side)
    );

    function onPosted(post) {
      // Prepend the new post instead of refetching the whole feed.
      const empty = feedHost.querySelector('.empty');
      if (empty) empty.remove();
      feedHost.prepend(postCard(post, { onRemoved: checkEmpty }));
    }

    function checkEmpty() {
      if (!feedHost.querySelector('.post')) {
        setEmpty(feedHost, 'Nothing here yet. Follow a few people or write the first post.', '\u{1F4DD}');
      }
    }

    setLoading(feedHost);
    try {
      const { posts, following_count } = await API.get('/api/social/feed');
      feedHost.innerHTML = '';

      if (!posts.length) {
        setEmpty(
          feedHost,
          following_count === 0
            ? 'Your feed is empty because you do not follow anyone yet. Try Explore, or follow someone from the sidebar.'
            : 'The people you follow have not posted yet.',
          '\u{1F4EC}'
        );
        return;
      }
      posts.forEach((post) => feedHost.append(postCard(post, { onRemoved: checkEmpty })));
    } catch (err) {
      showError(feedHost, err);
    }
  }

  /* --------------------------- explore page --------------------------- */

  async function renderExplore(root) {
    const searchInput = el('input', {
      type: 'search', placeholder: 'Search posts and people…', 'aria-label': 'Search posts',
    });
    const postsHost = el('div');

    root.innerHTML = '';
    root.append(
      el('div', { class: 'page-head' },
        el('div', {},
          el('h1', { text: 'Explore' }),
          el('p', { class: 'muted', style: 'margin:0', text: 'Every post on the platform.' }))),
      tabs('explore'),
      el('div', { class: 'card', style: 'margin-bottom:18px' }, searchInput),
      el('div', { class: 'social-layout' },
        postsHost,
        Shell.user() ? el('aside', { class: 'social-side' }, suggestionsCard()) : el('div'))
    );

    async function load() {
      setLoading(postsHost);
      const q = searchInput.value.trim();
      try {
        const { posts } = await API.get(`/api/social/explore?search=${encodeURIComponent(q)}`);
        postsHost.innerHTML = '';
        if (!posts.length) {
          setEmpty(postsHost, q ? `No posts match "${q}".` : 'No posts yet.', '\u{1F50D}');
          return;
        }
        posts.forEach((post) => postsHost.append(postCard(post)));
      } catch (err) {
        showError(postsHost, err);
      }
    }

    let timer = null;
    searchInput.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(load, 280);
    });

    load();
  }

  /* --------------------------- profile page --------------------------- */

  async function renderProfile(root) {
    const params = new URLSearchParams(location.search);
    const username = params.get('u') || Shell.user()?.username;

    root.innerHTML = '';
    const host = el('div');
    root.append(tabs('profile'), host);

    if (!username) {
      return showError(host, new Error('No profile was requested.'));
    }

    setLoading(host);

    try {
      const { profile, posts } = await API.get(`/api/social/users/${encodeURIComponent(username)}`);
      document.title = `${profile.display_name} (@${profile.username}) - Social`;

      /* --- follow button --- */
      const followBtn = el('button', {
        class: `btn ${profile.followed_by_me ? 'btn-ghost' : ''}`.trim(), type: 'button',
      }, profile.followed_by_me ? 'Unfollow' : 'Follow');

      const followerStat = el('strong', { text: String(profile.follower_count) });

      followBtn.addEventListener('click', async () => {
        if (!Shell.user()) {
          toast('Please log in to follow people.', 'info');
          return Shell.promptLogin();
        }
        await withBusy(followBtn, async () => {
          try {
            const { following, follower_count, message } = await API.post(
              `/api/social/users/${encodeURIComponent(profile.username)}/follow`
            );
            toastOk(message);
            followBtn.textContent = following ? 'Unfollow' : 'Follow';
            followBtn.classList.toggle('btn-ghost', following);
            followerStat.textContent = String(follower_count);
          } catch (err) {
            toastError(err.message);
          }
        });
      });

      /* --- followers / following lists --- */
      function openRelations(kind) {
        const list = el('div');
        openModal(kind === 'followers' ? 'Followers' : 'Following', list);
        setLoading(list);
        API.get(`/api/social/users/${encodeURIComponent(profile.username)}/${kind}`)
          .then(({ users }) => {
            list.innerHTML = '';
            if (!users.length) {
              list.append(el('p', { class: 'muted center',
                text: kind === 'followers' ? 'No followers yet.' : 'Not following anyone yet.' }));
              return;
            }
            for (const user of users) {
              list.append(
                el('div', { class: 'user-row' },
                  avatarNode(user, 'avatar-sm'),
                  el('div', { class: 'grow' },
                    profileLink(user, 'username'),
                    el('span', { class: 'handle', text: `@${user.username}` })))
              );
            }
          })
          .catch((err) => showError(list, err));
      }

      const followersStat = el('div', { class: 'profile-stat' },
        followerStat, el('span', { text: 'followers' }));
      followersStat.addEventListener('click', () => openRelations('followers'));

      const followingStat = el('div', { class: 'profile-stat' },
        el('strong', { text: String(profile.following_count) }), el('span', { text: 'following' }));
      followingStat.addEventListener('click', () => openRelations('following'));

      /* --- own-profile edit button --- */
      const editBtn = el('button', { class: 'btn btn-ghost', type: 'button' }, 'Edit profile');
      editBtn.addEventListener('click', () => openProfileEditor(profile));

      const postsHost = el('div');

      host.innerHTML = '';
      host.append(
        el('div', { class: 'card profile-head' },
          avatarNode(profile, 'avatar-lg'),
          el('div', { class: 'grow' },
            el('h1', { text: profile.display_name, style: 'margin-bottom:2px' }),
            el('p', { class: 'muted small', style: 'margin:0',
              text: `@${profile.username} · joined ${formatDate(profile.created_at)}` }),
            el('div', { class: 'profile-stats' },
              el('div', { class: 'profile-stat' },
                el('strong', { text: String(profile.post_count) }), el('span', { text: 'posts' })),
              followersStat,
              followingStat),
            profile.bio ? el('p', { class: 'profile-bio', text: profile.bio }) : null),
          el('div', {}, profile.is_me ? editBtn : (Shell.user() ? followBtn : null))),
        profile.is_me ? composer((post) => postsHost.prepend(postCard(post))) : null,
        el('h2', { text: profile.is_me ? 'Your posts' : `Posts by ${profile.display_name}` }),
        postsHost
      );

      if (!posts.length) {
        setEmpty(postsHost, profile.is_me ? 'You have not posted yet.' : 'No posts yet.', '\u{1F4DD}');
      } else {
        posts.forEach((post) => postsHost.append(postCard(post)));
      }
    } catch (err) {
      host.innerHTML = '';
      showError(host, err);
      host.append(el('p', { style: 'margin-top:12px' }, el('a', { href: '/social/' }, '← Back to the feed')));
    }
  }

  /** Bio / display name / avatar editor. */
  function openProfileEditor(profile) {
    const nameInput = el('input', { type: 'text', name: 'display_name', maxlength: '60', value: profile.display_name });
    const bioInput = el('textarea', { name: 'bio', maxlength: '300', placeholder: 'Tell people about yourself' });
    bioInput.value = profile.bio || '';

    const avatarInput = el('input', { type: 'file', accept: 'image/*' });
    const avatarPreview = el('div', { style: 'margin-top:10px' });
    let removeAvatar = false;

    function paintAvatar(src) {
      avatarPreview.innerHTML = '';
      avatarPreview.append(
        el('img', { class: 'avatar avatar-lg', src, alt: 'Avatar preview' })
      );
      if (src) {
        const clear = el('button', { class: 'icon-btn', type: 'button', style: 'color:var(--danger)' }, 'Remove avatar');
        clear.addEventListener('click', () => {
          removeAvatar = true;
          avatarInput.value = '';
          avatarPreview.innerHTML = '';
        });
        avatarPreview.append(clear);
      }
    }
    if (profile.avatar_url) paintAvatar(profile.avatar_url);

    avatarInput.addEventListener('change', () => {
      const file = avatarInput.files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        toastError('Please choose an avatar under 2MB.');
        avatarInput.value = '';
        return;
      }
      removeAvatar = false;
      paintAvatar(URL.createObjectURL(file));
    });

    const feedback = el('div');
    const submit = el('button', { class: 'btn btn-block', type: 'submit' }, 'Save profile');

    const form = el('form', { novalidate: 'novalidate' },
      el('div', { class: 'field' }, el('label', { text: 'Display name' }), nameInput),
      el('div', { class: 'field' }, el('label', { text: 'Bio' }), bioInput),
      el('div', { class: 'field' },
        el('label', { text: 'Avatar' }),
        el('label', { class: 'file-pick' }, '\u{1F5BC} Choose image', avatarInput),
        avatarPreview),
      feedback,
      submit);

    const close = openModal('Edit profile', form);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      feedback.innerHTML = '';

      const data = new FormData();
      data.set('display_name', nameInput.value.trim());
      data.set('bio', bioInput.value.trim());
      const file = avatarInput.files?.[0];
      if (file) data.set('avatar', file);
      else if (removeAvatar) data.set('remove_avatar', 'true');

      await withBusy(submit, async () => {
        try {
          await API.upload('/api/social/profile', data, 'PUT');
          close();
          toastOk('Profile updated.');
          location.reload(); // simplest way to refresh every avatar on the page
        } catch (err) {
          showError(feedback, err);
        }
      });
    });
  }

  return { renderFeed, renderExplore, renderProfile, postCard, composer, tabs };
})();

window.Social = Social;
