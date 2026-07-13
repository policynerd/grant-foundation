const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const grantFoundation = require('./index');

test('mounts as express middleware and serves health payload', async () => {
  const app = express();
  const server = app.use('/grants', grantFoundation({ root: '/grants' })).listen(0);
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/grants/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      name: 'grant-foundation',
      root: '/grants'
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('serves foundation metadata at the root route', async () => {
  const app = express();
  const server = app.use('/grants', grantFoundation({ root: '/grants', dbPath: ':memory:' })).listen(0);
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/grants`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      ok: true,
      name: 'grant-foundation',
      root: '/grants',
      endpoints: {
        health: '/grants/health'
      }
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('supports intake, review, decision, and payment workflow with role checks', async () => {
  const app = express();
  const server = app.use('/grants', grantFoundation({ root: '/grants', dbPath: ':memory:' })).listen(0);
  const { port } = server.address();
  const url = (pathname) => `http://127.0.0.1:${port}${pathname}`;
  const request = (pathname, options = {}) => fetch(url(pathname), options);
  const requestAs = (userId, pathname, options = {}) => request(pathname, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-user-id': userId,
      ...(options.headers || {})
    }
  });

  try {
    const createGrantResponse = await requestAs('officer-1', '/grants/grants', {
      method: 'POST',
      body: JSON.stringify({
        title: 'Youth Learning Fund',
        description: 'Support after-school tutoring organizations.',
        organization: 'Civic Ed Network'
      })
    });
    assert.equal(createGrantResponse.status, 201);
    const createdGrant = await createGrantResponse.json();
    const grantId = createdGrant.grant.id;

    const openGrantResponse = await requestAs('officer-1', `/grants/grants/${grantId}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'open' })
    });
    assert.equal(openGrantResponse.status, 200);

    const submitApplicationResponse = await requestAs('applicant-1', '/grants/applications', {
      method: 'POST',
      body: JSON.stringify({
        grantId,
        summary: 'We will expand tutoring to 120 additional students.'
      })
    });
    assert.equal(submitApplicationResponse.status, 201);
    const submittedApplication = await submitApplicationResponse.json();
    const applicationId = submittedApplication.application.id;

    const reviewResponse = await requestAs('reviewer-1', `/grants/applications/${applicationId}/reviews`, {
      method: 'POST',
      body: JSON.stringify({
        score: 9,
        notes: 'Strong measurable outcomes and community partners.'
      })
    });
    assert.equal(reviewResponse.status, 201);

    const decisionResponse = await requestAs('officer-1', `/grants/applications/${applicationId}/decision`, {
      method: 'POST',
      body: JSON.stringify({
        decision: 'approved',
        notes: 'Approved after panel review.'
      })
    });
    assert.equal(decisionResponse.status, 201);

    const paymentResponse = await requestAs('finance-1', `/grants/applications/${applicationId}/payments`, {
      method: 'POST',
      body: JSON.stringify({ amount: 25000 })
    });
    assert.equal(paymentResponse.status, 201);

    const applicantApplicationsResponse = await requestAs('applicant-1', '/grants/applications');
    assert.equal(applicantApplicationsResponse.status, 200);
    const applicantApplications = await applicantApplicationsResponse.json();
    assert.equal(applicantApplications.applications.length, 1);
    assert.equal(applicantApplications.applications[0].status, 'approved');

    const auditLogsResponse = await requestAs('admin-1', '/grants/audit-logs');
    assert.equal(auditLogsResponse.status, 200);
    const auditLogs = await auditLogsResponse.json();
    assert.equal(auditLogs.ok, true);
    assert.equal(auditLogs.logs.length >= 5, true);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('rejects unauthorized creation attempts', async () => {
  const app = express();
  const server = app.use('/grants', grantFoundation({ root: '/grants', dbPath: ':memory:' })).listen(0);
  const { port } = server.address();

  try {
    const response = await fetch(`http://127.0.0.1:${port}/grants/grants`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-user-id': 'applicant-1'
      },
      body: JSON.stringify({
        title: 'Invalid attempt',
        description: 'Should fail',
        organization: 'Unauthorized Org'
      })
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: 'Insufficient permissions'
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
