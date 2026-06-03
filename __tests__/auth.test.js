const { generateToken, verifyToken } = require('../src/utils/auth');

describe('Auth Utils', () => {
  it('should generate and verify a token', () => {
    const user = { id: 'test-id', username: 'test-user' };
    const token = generateToken(user);
    expect(token).toBeDefined();

    const decoded = verifyToken(token);
    expect(decoded).toBeDefined();
    expect(decoded.userId).toBe('test-id');
    expect(decoded.username).toBe('test-user');
  });

  it('should return null for invalid token', () => {
    expect(verifyToken('invalid.token')).toBeNull();
  });
});
