/**
 * TASK 2 - Social media platform API.
 *
 *   GET    /api/social/feed                 posts from people you follow + your own
 *   GET    /api/social/explore              every post, newest first
 *   POST   /api/social/posts                create a post (text + optional image)
 *   GET    /api/social/posts/:id            one post with its comments
 *   PUT    /api/social/posts/:id            edit your own post
 *   DELETE /api/social/posts/:id            delete your own post
 *   POST   /api/social/posts/:id/like       like / unlike (toggle)
 *   GET    /api/social/posts/:id/comments   comments on a post
 *   POST   /api/social/posts/:id/comments   add a comment
 *   DELETE /api/social/comments/:id         delete your own comment
 *   GET    /api/social/users/:username      a profile with counts and posts
 *   PUT    /api/social/profile              edit your bio / display name / avatar
 *   POST   /api/social/users/:username/follow   follow / unfollow (toggle)
 *   GET    /api/social/users/:username/followers
 *   GET    /api/social/users/:username/following
 *   GET    /api/social/suggestions          people you do not follow yet
 */
const fs = require('fs');
const path = require('path');
const express = require('express');

const { db } = require('../db');
const asyncHandler = require('../utils/asyncHandler');
const { authRequired } = require('../middleware/auth');
const { uploadAvatar, uploadPostImage, UPLOAD_ROOT } = require('../middleware/upload');
const {
  ApiError,
  requireString,
  optionalString,
  requireInt,
  requireUsername,
} = require('../utils/validate');

const router = express.Router();

/* --------------------------------------------------------------------
   Shared SQL pieces
   ------------------------------------------------------------------ */

/**
 * Columns every post list needs: author details, like and comment counts, and
 * whether the viewer has liked it. `viewerId` is bound twice - once for the
 * liked_by_me subquery and once per call site - so there is no string building.
 */
const POST_SELECT = `
  SELECT p.id, p.user_id, p.content, p.image_url, p.created_at, p.updated_at,
         u.username,
         COALESCE(pr.display_name, u.username) AS display_name,
         COALESCE(pr.avatar_url, '')           AS avatar_url,
         (SELECT COUNT(*) FROM likes l    WHERE l.post_id = p.id)                 AS like_count,
         (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id)                 AS comment_count,
         EXISTS (SELECT 1 FROM likes l WHERE l.post_id = p.id AND l.user_id = ?)  AS liked_by_me
    FROM posts p
    JOIN users u     ON u.id = p.user_id
    LEFT JOIN profiles pr ON pr.user_id = p.user_id
`;

/** Makes sure a user has a profile row before it is read or updated. */
function ensureProfile(userId, username) {
  db.prepare('INSERT OR IGNORE INTO profiles (user_id, display_name) VALUES (?, ?)')
    .run(userId, username || '');
}

/** Deletes an uploaded file that is no longer referenced, ignoring failures. */
function removeUpload(url) {
  if (!url || !url.startsWith('/uploads/')) return;
  // Resolve and confirm the path stays inside the uploads folder before
  // unlinking, so a crafted stored URL cannot delete anything else.
  const target = path.resolve(UPLOAD_ROOT, '.' + url.replace('/uploads', ''));
  if (!target.startsWith(path.resolve(UPLOAD_ROOT))) return;
  fs.promises.unlink(target).catch(() => {});
}

/* --------------------------------------------------------------------
   Feeds
   ------------------------------------------------------------------ */

// GET /api/social/feed - your own posts plus everyone you follow.
router.get(
  '/feed',
  authRequired,
  asyncHandler(async (req, res) => {
    const viewerId = req.user.id;
    const posts = db
      .prepare(
        `${POST_SELECT}
          WHERE p.user_id = ?
             OR p.user_id IN (SELECT following_id FROM follows WHERE follower_id = ?)
          ORDER BY p.created_at DESC, p.id DESC
          LIMIT 100`
      )
      .all(viewerId, viewerId, viewerId);

    const followingCount = db
      .prepare('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?')
      .get(viewerId).n;

    res.json({ posts, following_count: followingCount });
  })
);

// GET /api/social/explore - every post. Public, so logged-out visitors can look.
router.get(
  '/explore',
  asyncHandler(async (req, res) => {
    const viewerId = req.user?.id || 0; // 0 matches no user, so liked_by_me is false
    const search = (req.query.search || '').toString().trim();

    const posts = search
      ? db
          .prepare(
            `${POST_SELECT}
              WHERE p.content LIKE ? OR u.username LIKE ?
              ORDER BY p.created_at DESC, p.id DESC LIMIT 100`
          )
          .all(viewerId, `%${search}%`, `%${search}%`)
      : db
          .prepare(`${POST_SELECT} ORDER BY p.created_at DESC, p.id DESC LIMIT 100`)
          .all(viewerId);

    res.json({ posts });
  })
);

/* --------------------------------------------------------------------
   Posts
   ------------------------------------------------------------------ */

// POST /api/social/posts - multipart so an optional image can ride along.
router.post(
  '/posts',
  authRequired,
  uploadPostImage.single('image'),
  asyncHandler(async (req, res) => {
    const content = requireString(req.body.content, 'Post text', { min: 1, max: 2000 });
    const imageUrl = req.file ? `/uploads/posts/${req.file.filename}` : '';

    const info = db
      .prepare('INSERT INTO posts (user_id, content, image_url) VALUES (?, ?, ?)')
      .run(req.user.id, content, imageUrl);

    const post = db
      .prepare(`${POST_SELECT} WHERE p.id = ?`)
      .get(req.user.id, Number(info.lastInsertRowid));

    res.status(201).json({ post, message: 'Post published.' });
  })
);

// GET /api/social/posts/:id
router.get(
  '/posts/:id',
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'Post id', { min: 1 });
    const viewerId = req.user?.id || 0;

    const post = db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(viewerId, id);
    if (!post) throw new ApiError(404, 'That post no longer exists.');

    post.comments = db
      .prepare(
        `SELECT c.id, c.content, c.created_at, c.user_id, u.username,
                COALESCE(pr.display_name, u.username) AS display_name,
                COALESCE(pr.avatar_url, '')           AS avatar_url
           FROM comments c
           JOIN users u ON u.id = c.user_id
           LEFT JOIN profiles pr ON pr.user_id = c.user_id
          WHERE c.post_id = ?
          ORDER BY c.created_at ASC, c.id ASC`
      )
      .all(id);

    res.json({ post });
  })
);

// PUT /api/social/posts/:id - edit text, and optionally replace or drop the image.
router.put(
  '/posts/:id',
  authRequired,
  uploadPostImage.single('image'),
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'Post id', { min: 1 });
    const content = requireString(req.body.content, 'Post text', { min: 1, max: 2000 });

    const existing = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
    if (!existing) throw new ApiError(404, 'That post no longer exists.');
    // Ownership check: only the author may edit.
    if (existing.user_id !== req.user.id) {
      throw new ApiError(403, 'You can only edit your own posts.');
    }

    let imageUrl = existing.image_url;
    if (req.file) {
      imageUrl = `/uploads/posts/${req.file.filename}`;
      removeUpload(existing.image_url); // the old file is now orphaned
    } else if (req.body.remove_image === 'true') {
      imageUrl = '';
      removeUpload(existing.image_url);
    }

    db.prepare(
      "UPDATE posts SET content = ?, image_url = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f','now') WHERE id = ?"
    ).run(content, imageUrl, id);

    const post = db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(req.user.id, id);
    res.json({ post, message: 'Post updated.' });
  })
);

// DELETE /api/social/posts/:id
router.delete(
  '/posts/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'Post id', { min: 1 });
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(id);
    if (!post) throw new ApiError(404, 'That post no longer exists.');
    if (post.user_id !== req.user.id) {
      throw new ApiError(403, 'You can only delete your own posts.');
    }

    // Likes and comments go with it via ON DELETE CASCADE.
    db.prepare('DELETE FROM posts WHERE id = ?').run(id);
    removeUpload(post.image_url);

    res.json({ message: 'Post deleted.' });
  })
);

/* --------------------------------------------------------------------
   Likes
   ------------------------------------------------------------------ */

// POST /api/social/posts/:id/like - one endpoint toggles both ways, so a
// double click cannot leave the UI and database disagreeing.
router.post(
  '/posts/:id/like',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'Post id', { min: 1 });
    const exists = db.prepare('SELECT 1 FROM posts WHERE id = ?').get(id);
    if (!exists) throw new ApiError(404, 'That post no longer exists.');

    const already = db
      .prepare('SELECT 1 FROM likes WHERE post_id = ? AND user_id = ?')
      .get(id, req.user.id);

    if (already) {
      db.prepare('DELETE FROM likes WHERE post_id = ? AND user_id = ?').run(id, req.user.id);
    } else {
      db.prepare('INSERT INTO likes (post_id, user_id) VALUES (?, ?)').run(id, req.user.id);
    }

    const likeCount = db.prepare('SELECT COUNT(*) AS n FROM likes WHERE post_id = ?').get(id).n;
    res.json({ liked: !already, like_count: likeCount });
  })
);

/* --------------------------------------------------------------------
   Comments
   ------------------------------------------------------------------ */

// GET /api/social/posts/:id/comments
router.get(
  '/posts/:id/comments',
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'Post id', { min: 1 });
    const comments = db
      .prepare(
        `SELECT c.id, c.content, c.created_at, c.user_id, u.username,
                COALESCE(pr.display_name, u.username) AS display_name,
                COALESCE(pr.avatar_url, '')           AS avatar_url
           FROM comments c
           JOIN users u ON u.id = c.user_id
           LEFT JOIN profiles pr ON pr.user_id = c.user_id
          WHERE c.post_id = ?
          ORDER BY c.created_at ASC, c.id ASC`
      )
      .all(id);
    res.json({ comments });
  })
);

// POST /api/social/posts/:id/comments
router.post(
  '/posts/:id/comments',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'Post id', { min: 1 });
    const content = requireString(req.body.content, 'Comment', { min: 1, max: 1000 });

    const exists = db.prepare('SELECT 1 FROM posts WHERE id = ?').get(id);
    if (!exists) throw new ApiError(404, 'That post no longer exists.');

    const info = db
      .prepare('INSERT INTO comments (post_id, user_id, content) VALUES (?, ?, ?)')
      .run(id, req.user.id, content);

    const comment = db
      .prepare(
        `SELECT c.id, c.content, c.created_at, c.user_id, u.username,
                COALESCE(pr.display_name, u.username) AS display_name,
                COALESCE(pr.avatar_url, '')           AS avatar_url
           FROM comments c
           JOIN users u ON u.id = c.user_id
           LEFT JOIN profiles pr ON pr.user_id = c.user_id
          WHERE c.id = ?`
      )
      .get(Number(info.lastInsertRowid));

    const commentCount = db
      .prepare('SELECT COUNT(*) AS n FROM comments WHERE post_id = ?')
      .get(id).n;

    res.status(201).json({ comment, comment_count: commentCount });
  })
);

// DELETE /api/social/comments/:id - the comment author or the post author.
router.delete(
  '/comments/:id',
  authRequired,
  asyncHandler(async (req, res) => {
    const id = requireInt(req.params.id, 'Comment id', { min: 1 });
    const row = db
      .prepare(
        `SELECT c.id, c.user_id, c.post_id, p.user_id AS post_author
           FROM comments c JOIN posts p ON p.id = c.post_id
          WHERE c.id = ?`
      )
      .get(id);
    if (!row) throw new ApiError(404, 'That comment no longer exists.');

    // A post author can moderate comments on their own post.
    if (row.user_id !== req.user.id && row.post_author !== req.user.id) {
      throw new ApiError(403, 'You can only delete your own comments.');
    }

    db.prepare('DELETE FROM comments WHERE id = ?').run(id);
    const commentCount = db
      .prepare('SELECT COUNT(*) AS n FROM comments WHERE post_id = ?')
      .get(row.post_id).n;

    res.json({ message: 'Comment deleted.', comment_count: commentCount });
  })
);

/* --------------------------------------------------------------------
   Profiles
   ------------------------------------------------------------------ */

// GET /api/social/users/:username
router.get(
  '/users/:username',
  asyncHandler(async (req, res) => {
    const username = requireUsername(req.params.username);
    const viewerId = req.user?.id || 0;

    const user = db
      .prepare('SELECT id, username, created_at FROM users WHERE username = ?')
      .get(username);
    if (!user) throw new ApiError(404, 'No such user.');

    ensureProfile(user.id, user.username);

    const profile = db
      .prepare(
        `SELECT u.id, u.username, u.created_at,
                COALESCE(pr.display_name, u.username) AS display_name,
                COALESCE(pr.bio, '')                  AS bio,
                COALESCE(pr.avatar_url, '')           AS avatar_url,
                (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS follower_count,
                (SELECT COUNT(*) FROM follows f WHERE f.follower_id  = u.id) AS following_count,
                (SELECT COUNT(*) FROM posts   p WHERE p.user_id      = u.id) AS post_count,
                EXISTS (SELECT 1 FROM follows f
                         WHERE f.follower_id = ? AND f.following_id = u.id)  AS followed_by_me
           FROM users u
           LEFT JOIN profiles pr ON pr.user_id = u.id
          WHERE u.id = ?`
      )
      .get(viewerId, user.id);

    profile.is_me = viewerId === user.id;

    const posts = db
      .prepare(
        `${POST_SELECT} WHERE p.user_id = ? ORDER BY p.created_at DESC, p.id DESC LIMIT 100`
      )
      .all(viewerId, user.id);

    res.json({ profile, posts });
  })
);

// PUT /api/social/profile - multipart, because the avatar is a file upload.
router.put(
  '/profile',
  authRequired,
  uploadAvatar.single('avatar'),
  asyncHandler(async (req, res) => {
    ensureProfile(req.user.id, req.user.username);

    const displayName = optionalString(req.body.display_name, 'Display name', { max: 60 });
    const bio = optionalString(req.body.bio, 'Bio', { max: 300 });

    const current = db.prepare('SELECT avatar_url FROM profiles WHERE user_id = ?').get(req.user.id);
    let avatarUrl = current?.avatar_url || '';

    if (req.file) {
      avatarUrl = `/uploads/avatars/${req.file.filename}`;
      removeUpload(current?.avatar_url);
    } else if (req.body.remove_avatar === 'true') {
      avatarUrl = '';
      removeUpload(current?.avatar_url);
    }

    db.prepare(
      `UPDATE profiles
          SET display_name = ?, bio = ?, avatar_url = ?, updated_at = strftime('%Y-%m-%d %H:%M:%f','now')
        WHERE user_id = ?`
    ).run(displayName || req.user.username, bio, avatarUrl, req.user.id);

    res.json({
      profile: db
        .prepare('SELECT * FROM profiles WHERE user_id = ?')
        .get(req.user.id),
      message: 'Profile updated.',
    });
  })
);

/* --------------------------------------------------------------------
   Follows
   ------------------------------------------------------------------ */

// POST /api/social/users/:username/follow - toggles, like the like endpoint.
router.post(
  '/users/:username/follow',
  authRequired,
  asyncHandler(async (req, res) => {
    const username = requireUsername(req.params.username);
    const target = db.prepare('SELECT id, username FROM users WHERE username = ?').get(username);
    if (!target) throw new ApiError(404, 'No such user.');
    if (target.id === req.user.id) throw new ApiError(400, 'You cannot follow yourself.');

    const already = db
      .prepare('SELECT 1 FROM follows WHERE follower_id = ? AND following_id = ?')
      .get(req.user.id, target.id);

    if (already) {
      db.prepare('DELETE FROM follows WHERE follower_id = ? AND following_id = ?')
        .run(req.user.id, target.id);
    } else {
      db.prepare('INSERT INTO follows (follower_id, following_id) VALUES (?, ?)')
        .run(req.user.id, target.id);
    }

    const followerCount = db
      .prepare('SELECT COUNT(*) AS n FROM follows WHERE following_id = ?')
      .get(target.id).n;

    res.json({
      following: !already,
      follower_count: followerCount,
      message: already ? `Unfollowed ${target.username}.` : `You now follow ${target.username}.`,
    });
  })
);

/** Shared query for the followers / following lists. */
function relationList(username, direction, viewerId) {
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!user) throw new ApiError(404, 'No such user.');

  // Both directions use the same shape, only the join columns swap, so the
  // column names are chosen from a fixed pair rather than built from input.
  const [joinOn, matchOn] =
    direction === 'followers' ? ['follower_id', 'following_id'] : ['following_id', 'follower_id'];

  return db
    .prepare(
      `SELECT u.id, u.username,
              COALESCE(pr.display_name, u.username) AS display_name,
              COALESCE(pr.avatar_url, '')           AS avatar_url,
              EXISTS (SELECT 1 FROM follows f2
                       WHERE f2.follower_id = ? AND f2.following_id = u.id) AS followed_by_me
         FROM follows f
         JOIN users u ON u.id = f.${joinOn}
         LEFT JOIN profiles pr ON pr.user_id = u.id
        WHERE f.${matchOn} = ?
        ORDER BY u.username`
    )
    .all(viewerId, user.id);
}

router.get(
  '/users/:username/followers',
  asyncHandler(async (req, res) => {
    const username = requireUsername(req.params.username);
    res.json({ users: relationList(username, 'followers', req.user?.id || 0) });
  })
);

router.get(
  '/users/:username/following',
  asyncHandler(async (req, res) => {
    const username = requireUsername(req.params.username);
    res.json({ users: relationList(username, 'following', req.user?.id || 0) });
  })
);

// GET /api/social/suggestions - people the viewer does not follow yet.
router.get(
  '/suggestions',
  authRequired,
  asyncHandler(async (req, res) => {
    const users = db
      .prepare(
        `SELECT u.id, u.username,
                COALESCE(pr.display_name, u.username) AS display_name,
                COALESCE(pr.avatar_url, '')           AS avatar_url,
                COALESCE(pr.bio, '')                  AS bio,
                (SELECT COUNT(*) FROM follows f WHERE f.following_id = u.id) AS follower_count
           FROM users u
           LEFT JOIN profiles pr ON pr.user_id = u.id
          WHERE u.id <> ?
            AND u.id NOT IN (SELECT following_id FROM follows WHERE follower_id = ?)
          ORDER BY follower_count DESC, u.username
          LIMIT 10`
      )
      .all(req.user.id, req.user.id);
    res.json({ users });
  })
);

module.exports = router;
