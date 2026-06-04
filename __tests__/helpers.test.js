const { sanitizeString, generateICS } = require('../src/utils/helpers');

describe('Helpers', () => {
  it('should sanitize strings', () => {
    expect(sanitizeString('Hello <script>alert(1)</script> World')).toBe('Hello alert(1) World');
    expect(sanitizeString(123)).toBe('');
  });

  it('should generate ICS content', () => {
    const ics = generateICS({
      title: 'Test Meeting',
      startDate: new Date('2026-06-03T23:00:00Z').toISOString(),
      durationMinutes: 60,
      roomId: 'test-room'
    });
    expect(ics).toContain('BEGIN:VCALENDAR');
    expect(ics).toContain('SUMMARY:Test Meeting');
  });
});
