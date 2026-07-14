const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { ipKeyGenerator, rateLimit } = require('express-rate-limit');

const WORKFLOWS = ['intake', 'review', 'approval', 'contracting', 'disbursement', 'reporting', 'closeout'];
const ROLES = ['applicant', 'reviewer', 'program_officer', 'finance', 'admin'];
const GRANT_STATUSES = ['draft', 'open', 'closed'];
const APPLICATION_STATUSES = ['submitted', 'under_review', 'approved', 'rejected'];
const MAX_TEXT_LENGTH = 5_000;

const DEFAULT_USERS = [
  { id: 'applicant-1', name: 'Ari Applicant', role: 'applicant' },
  { id: 'reviewer-1', name: 'Riley Reviewer', role: 'reviewer' },
  { id: 'officer-1', name: 'Parker Program', role: 'program_officer' },
  { id: 'finance-1', name: 'Finley Finance', role: 'finance' },
  { id: 'admin-1', name: 'Alex Admin', role: 'admin' }
];

function initializeDatabase(db) {
  db.pragma('foreign_keys = ON');
  const journalMode = db.name === ':memory:' ? 'MEMORY' : 'WAL';
  db.pragma(`journal_mode = ${journalMode}`);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('applicant', 'reviewer', 'program_officer', 'finance', 'admin'))
    );

    CREATE TABLE IF NOT EXISTS organizations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS grants (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      organization_id INTEGER NOT NULL REFERENCES organizations(id),
      status TEXT NOT NULL CHECK (status IN ('draft', 'open', 'closed')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      grant_id INTEGER NOT NULL REFERENCES grants(id),
      applicant_user_id TEXT NOT NULL REFERENCES users(id),
      summary TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('submitted', 'under_review', 'approved', 'rejected')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL REFERENCES applications(id),
      reviewer_user_id TEXT NOT NULL REFERENCES users(id),
      score INTEGER NOT NULL CHECK (score >= 1 AND score <= 10),
      notes TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS decisions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL REFERENCES applications(id),
      decider_user_id TEXT NOT NULL REFERENCES users(id),
      decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
      notes TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      application_id INTEGER NOT NULL REFERENCES applications(id),
      amount REAL NOT NULL CHECK (amount > 0),
      status TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor_user_id TEXT NOT NULL REFERENCES users(id),
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      metadata TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);

  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
  if (userCount === 0) {
    const insertUser = db.prepare('INSERT INTO users (id, name, role) VALUES (@id, @name, @role)');
    const insertOrg = db.prepare('INSERT INTO organizations (name) VALUES (?)');
    const insertGrant = db.prepare(`
      INSERT INTO grants (title, description, organization_id, status, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    const transaction = db.transaction(() => {
      for (const user of DEFAULT_USERS) {
        insertUser.run(user);
      }
      const organizationResult = insertOrg.run('Community Impact Fund');
      insertGrant.run(
        'Neighborhood Resilience Pilot',
        'Fund local organizations focused on climate adaptation projects.',
        organizationResult.lastInsertRowid,
        'open',
        now
      );
    });
    transaction();
  }
}

function toIsoNow() {
  return new Date().toISOString();
}

function readUiTemplate() {
  return fs.readFileSync(path.join(__dirname, 'public', 'app.html'), 'utf8');
}

function cleanText(value, fieldName, { maxLength = MAX_TEXT_LENGTH } = {}) {
  if (typeof value !== 'string') {
    return { error: `${fieldName} is required` };
  }
  const text = value.trim();
  if (!text) {
    return { error: `${fieldName} is required` };
  }
  if (text.length > maxLength) {
    return { error: `${fieldName} must be ${maxLength} characters or fewer` };
  }
  return { value: text };
}

function rateLimitKeyGenerator(req) {
  const forwardedFor = req.get('x-forwarded-for');
  const clientIp = forwardedFor
    ? forwardedFor.split(',')[0].trim()
    : req.ip || req.socket?.remoteAddress || 'unknown';
  return ipKeyGenerator(clientIp);
}

module.exports = function createGrantFoundation(config = {}) {
  const router = express.Router();
  const root = config.root || '';
  const name = config.name || 'grant-foundation';
  const dbPath = config.dbPath || ':memory:';
  const db = config.db || new Database(dbPath);
  initializeDatabase(db);

  router.use(express.json({ limit: config.jsonLimit || '64kb' }));
  router.use(rateLimit({
    windowMs: Number(config.rateLimitWindowMs) || 60_000,
    limit: Number(config.rateLimitLimit) || 120,
    keyGenerator: config.rateLimitKeyGenerator || rateLimitKeyGenerator,
    standardHeaders: true,
    legacyHeaders: false
  }));

  const writeAudit = db.prepare(`
    INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, metadata, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  function audit(actorUserId, action, entityType, entityId, metadata = {}) {
    writeAudit.run(actorUserId, action, entityType, String(entityId), JSON.stringify(metadata), toIsoNow());
  }

  function identifyUser(req, res, next) {
    const userId = req.get('x-user-id');
    if (!userId) {
      req.user = null;
      return next();
    }

    const user = db.prepare('SELECT id, name, role FROM users WHERE id = ?').get(userId);
    if (!user) {
      return res.status(401).json({ ok: false, error: 'Unknown user' });
    }

    req.user = user;
    return next();
  }

  function requireAuth(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ ok: false, error: 'Authentication required via x-user-id header' });
    }
    return next();
  }

  function requireRole(roles) {
    return (req, res, next) => {
      if (!req.user) {
        return res.status(401).json({ ok: false, error: 'Authentication required via x-user-id header' });
      }
      if (!roles.includes(req.user.role)) {
        return res.status(403).json({ ok: false, error: 'Insufficient permissions' });
      }
      return next();
    };
  }

  router.use(identifyUser);

  router.get('/', (_req, res) => {
    res.json({
      ok: true,
      name,
      root,
      endpoints: {
        health: `${root}/health`
      }
    });
  });

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      name,
      root
    });
  });

  router.get('/ui', (_req, res) => {
    res.type('html').send(readUiTemplate());
  });

  router.get('/config', (_req, res) => {
    res.json({
      ok: true,
      workflows: WORKFLOWS,
      roles: ROLES,
      applicationStatuses: APPLICATION_STATUSES,
      grantStatuses: GRANT_STATUSES
    });
  });

  router.get('/users', (_req, res) => {
    const users = db.prepare('SELECT id, name, role FROM users ORDER BY role, name').all();
    res.json({ ok: true, users });
  });

  router.get('/dashboard', requireAuth, (req, res) => {
    const totalGrants = db.prepare('SELECT COUNT(*) as count FROM grants').get().count;
    const applicationCounts = db.prepare(`
      SELECT status, COUNT(*) as count
      FROM applications
      GROUP BY status
      ORDER BY status
    `).all();
    const mine = req.user.role === 'applicant'
      ? db.prepare('SELECT COUNT(*) as count FROM applications WHERE applicant_user_id = ?').get(req.user.id).count
      : db.prepare('SELECT COUNT(*) as count FROM applications').get().count;

    res.json({
      ok: true,
      user: req.user,
      metrics: {
        totalGrants,
        visibleApplications: mine,
        byStatus: applicationCounts
      }
    });
  });

  router.get('/grants', requireAuth, (_req, res) => {
    const grants = db.prepare(`
      SELECT g.id, g.title, g.description, g.status, g.created_at as createdAt, o.name as organization
      FROM grants g
      JOIN organizations o ON o.id = g.organization_id
      ORDER BY g.id DESC
    `).all();
    res.json({ ok: true, grants });
  });

  router.post('/grants', requireRole(['program_officer', 'admin']), (req, res) => {
    const title = cleanText(req.body?.title, 'title', { maxLength: 200 });
    const description = cleanText(req.body?.description, 'description');
    const organization = cleanText(req.body?.organization, 'organization', { maxLength: 200 });
    const validationError = title.error || description.error || organization.error;
    if (validationError) {
      return res.status(400).json({ ok: false, error: validationError });
    }

    const now = toIsoNow();
    const upsertOrganization = db.prepare(`
      INSERT INTO organizations (name) VALUES (?)
      ON CONFLICT(name) DO UPDATE SET name = excluded.name
      RETURNING id
    `);
    const org = upsertOrganization.get(organization.value);

    const insertGrant = db.prepare(`
      INSERT INTO grants (title, description, organization_id, status, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const result = insertGrant.run(title.value, description.value, org.id, 'draft', now);
    audit(req.user.id, 'grant.created', 'grant', result.lastInsertRowid, { title: title.value });

    return res.status(201).json({
      ok: true,
      grant: {
        id: result.lastInsertRowid,
        title: title.value,
        description: description.value,
        organization: organization.value,
        status: 'draft',
        createdAt: now
      }
    });
  });

  router.patch('/grants/:grantId/status', requireRole(['program_officer', 'admin']), (req, res) => {
    const grantId = Number(req.params.grantId);
    const status = req.body?.status;
    if (!Number.isInteger(grantId) || grantId < 1) {
      return res.status(400).json({ ok: false, error: 'Invalid grant id' });
    }
    if (!GRANT_STATUSES.includes(status)) {
      return res.status(400).json({ ok: false, error: `status must be one of: ${GRANT_STATUSES.join(', ')}` });
    }

    const grant = db.prepare('SELECT id FROM grants WHERE id = ?').get(grantId);
    if (!grant) {
      return res.status(404).json({ ok: false, error: 'Grant not found' });
    }

    db.prepare('UPDATE grants SET status = ? WHERE id = ?').run(status, grantId);
    audit(req.user.id, 'grant.status.updated', 'grant', grantId, { status });
    return res.json({ ok: true, grant: { id: grantId, status } });
  });

  router.get('/applications', requireAuth, (req, res) => {
    const queryParts = [];
    const params = [];

    if (req.user.role === 'applicant') {
      queryParts.push('a.applicant_user_id = ?');
      params.push(req.user.id);
    }

    if (req.query.status) {
      if (!APPLICATION_STATUSES.includes(req.query.status)) {
        return res.status(400).json({ ok: false, error: `status must be one of: ${APPLICATION_STATUSES.join(', ')}` });
      }
      queryParts.push('a.status = ?');
      params.push(req.query.status);
    }

    if (req.query.q) {
      queryParts.push('a.summary LIKE ?');
      params.push(`%${String(req.query.q).trim().slice(0, 200)}%`);
    }

    const whereClause = queryParts.length > 0 ? `WHERE ${queryParts.join(' AND ')}` : '';
    const stmt = db.prepare(`
      SELECT
        a.id,
        a.summary,
        a.status,
        a.created_at as createdAt,
        g.id as grantId,
        g.title as grantTitle,
        u.id as applicantUserId,
        u.name as applicantName
      FROM applications a
      JOIN grants g ON g.id = a.grant_id
      JOIN users u ON u.id = a.applicant_user_id
      ${whereClause}
      ORDER BY a.id DESC
    `);

    const applications = stmt.all(...params);
    return res.json({ ok: true, applications });
  });

  router.post('/applications', requireRole(['applicant']), (req, res) => {
    const parsedGrantId = Number(req.body?.grantId);
    const summary = cleanText(req.body?.summary, 'summary');
    if (!Number.isInteger(parsedGrantId) || parsedGrantId < 1 || summary.error) {
      return res.status(400).json({ ok: false, error: summary.error || 'grantId is required' });
    }

    const grant = db.prepare('SELECT id, status FROM grants WHERE id = ?').get(parsedGrantId);
    if (!grant) {
      return res.status(404).json({ ok: false, error: 'Grant not found' });
    }
    if (grant.status !== 'open') {
      return res.status(400).json({ ok: false, error: 'Applications can only be submitted to open grants' });
    }

    const now = toIsoNow();
    const result = db.prepare(`
      INSERT INTO applications (grant_id, applicant_user_id, summary, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(parsedGrantId, req.user.id, summary.value, 'submitted', now, now);

    audit(req.user.id, 'application.submitted', 'application', result.lastInsertRowid, { grantId: parsedGrantId });
    return res.status(201).json({
      ok: true,
      application: {
        id: result.lastInsertRowid,
        grantId: parsedGrantId,
        applicantUserId: req.user.id,
        summary: summary.value,
        status: 'submitted',
        createdAt: now
      }
    });
  });

  router.post('/applications/:applicationId/reviews', requireRole(['reviewer']), (req, res) => {
    const applicationId = Number(req.params.applicationId);
    const score = Number(req.body?.score);
    const notes = cleanText(req.body?.notes, 'notes');

    if (!Number.isInteger(applicationId) || applicationId < 1) {
      return res.status(400).json({ ok: false, error: 'Invalid application id' });
    }
    if (!Number.isInteger(score) || score < 1 || score > 10 || notes.error) {
      return res.status(400).json({ ok: false, error: notes.error || 'score must be an integer from 1 to 10' });
    }

    const application = db.prepare('SELECT id, status FROM applications WHERE id = ?').get(applicationId);
    if (!application) {
      return res.status(404).json({ ok: false, error: 'Application not found' });
    }
    if (!['submitted', 'under_review'].includes(application.status)) {
      return res.status(400).json({ ok: false, error: 'Application is not in a reviewable state' });
    }

    const now = toIsoNow();
    const insertReview = db.prepare(`
      INSERT INTO reviews (application_id, reviewer_user_id, score, notes, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const updateStatus = db.prepare(`
      UPDATE applications SET status = 'under_review', updated_at = ? WHERE id = ?
    `);

    const transaction = db.transaction(() => {
      const result = insertReview.run(applicationId, req.user.id, score, notes.value, now);
      updateStatus.run(now, applicationId);
      audit(req.user.id, 'application.reviewed', 'application', applicationId, { reviewId: result.lastInsertRowid, score });
      return result.lastInsertRowid;
    });

    const reviewId = transaction();
    return res.status(201).json({
      ok: true,
      review: {
        id: reviewId,
        applicationId,
        reviewerUserId: req.user.id,
        score,
        notes: notes.value,
        createdAt: now
      }
    });
  });

  router.post('/applications/:applicationId/decision', requireRole(['program_officer', 'admin']), (req, res) => {
    const applicationId = Number(req.params.applicationId);
    const decision = req.body?.decision;
    const notes = typeof req.body?.notes === 'string' ? req.body.notes.trim().slice(0, MAX_TEXT_LENGTH) : '';

    if (!Number.isInteger(applicationId) || applicationId < 1) {
      return res.status(400).json({ ok: false, error: 'Invalid application id' });
    }
    if (!['approved', 'rejected'].includes(decision)) {
      return res.status(400).json({ ok: false, error: 'decision must be approved or rejected' });
    }

    const application = db.prepare('SELECT id, status FROM applications WHERE id = ?').get(applicationId);
    if (!application) {
      return res.status(404).json({ ok: false, error: 'Application not found' });
    }
    if (!['submitted', 'under_review'].includes(application.status)) {
      return res.status(400).json({ ok: false, error: 'Application has already been decided' });
    }

    const now = toIsoNow();
    const insertDecision = db.prepare(`
      INSERT INTO decisions (application_id, decider_user_id, decision, notes, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    const updateApplication = db.prepare('UPDATE applications SET status = ?, updated_at = ? WHERE id = ?');

    const transaction = db.transaction(() => {
      const result = insertDecision.run(applicationId, req.user.id, decision, notes, now);
      updateApplication.run(decision, now, applicationId);
      audit(req.user.id, 'application.decided', 'application', applicationId, { decision, decisionId: result.lastInsertRowid });
      return result.lastInsertRowid;
    });

    const decisionId = transaction();
    return res.status(201).json({
      ok: true,
      decision: {
        id: decisionId,
        applicationId,
        deciderUserId: req.user.id,
        decision,
        notes,
        createdAt: now
      }
    });
  });

  router.post('/applications/:applicationId/payments', requireRole(['finance', 'admin']), (req, res) => {
    const applicationId = Number(req.params.applicationId);
    const amount = Number(req.body?.amount);

    if (!Number.isInteger(applicationId) || applicationId < 1) {
      return res.status(400).json({ ok: false, error: 'Invalid application id' });
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ ok: false, error: 'amount must be a positive number' });
    }

    const application = db.prepare('SELECT id, status FROM applications WHERE id = ?').get(applicationId);
    if (!application) {
      return res.status(404).json({ ok: false, error: 'Application not found' });
    }
    if (application.status !== 'approved') {
      return res.status(400).json({ ok: false, error: 'Payments can only be recorded for approved applications' });
    }

    const now = toIsoNow();
    const result = db.prepare(`
      INSERT INTO payments (application_id, amount, status, created_at)
      VALUES (?, ?, 'scheduled', ?)
    `).run(applicationId, amount, now);

    audit(req.user.id, 'payment.recorded', 'payment', result.lastInsertRowid, { applicationId, amount });
    return res.status(201).json({
      ok: true,
      payment: {
        id: result.lastInsertRowid,
        applicationId,
        amount,
        status: 'scheduled',
        createdAt: now
      }
    });
  });

  router.get('/audit-logs', requireRole(['admin']), (req, res) => {
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const rows = db.prepare(`
      SELECT id, actor_user_id as actorUserId, action, entity_type as entityType, entity_id as entityId, metadata, created_at as createdAt
      FROM audit_logs
      ORDER BY id DESC
      LIMIT ?
    `).all(limit);
    res.json({
      ok: true,
      logs: rows.map((row) => ({ ...row, metadata: JSON.parse(row.metadata) }))
    });
  });

  return router;
};
