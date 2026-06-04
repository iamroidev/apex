const db = require('../database');
const fs = require('fs');
const path = require('path');

describe('Database Tests', () => {
  beforeAll(() => {
    // Reset or ensure test DB
    try { fs.unlinkSync(path.join(__dirname, '../apex.db')); } catch (e) {}
  });

  afterAll(() => {
    try { fs.unlinkSync(path.join(__dirname, '../apex.db')); } catch (e) {}
    try { fs.unlinkSync(path.join(__dirname, '../apex.db-shm')); } catch (e) {}
    try { fs.unlinkSync(path.join(__dirname, '../apex.db-wal')); } catch (e) {}
  });

  it('should create and verify user', async () => {
    const user = await db.createUser('test-1', 'test_user', 'password123');
    expect(user.id).toBe('test-1');
    expect(user.username).toBe('test_user');
    
    const verified = db.verifyPassword('password123', user.password_hash);
    expect(verified).toBe(true);
  });
  
  it('should create and retrieve session', async () => {
    const session = await db.createSession('session-1', 'Test Meeting', 'test_user');
    expect(session.id).toBe('session-1');
    
    const retrieved = await db.getSession('session-1');
    expect(retrieved.id).toBe('session-1');
  });
});
