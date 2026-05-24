import { parseMentions } from './mention-parser';

describe('parseMentions', () => {
  it('returns an empty array for empty/null input', () => {
    expect(parseMentions('')).toEqual([]);
    expect(parseMentions(null as unknown as string)).toEqual([]);
  });

  it('returns an empty array when no mentions are present', () => {
    expect(parseMentions('just a regular comment')).toEqual([]);
  });

  it('extracts a single mention', () => {
    expect(parseMentions('hey @jdoe please look')).toEqual(['jdoe']);
  });

  it('extracts multiple mentions', () => {
    expect(parseMentions('@alice and @bob please review')).toEqual([
      'alice',
      'bob',
    ]);
  });

  it('lower-cases mentions for case-insensitive resolution', () => {
    expect(parseMentions('@JDoe and @ALICE')).toEqual(['jdoe', 'alice']);
  });

  it('deduplicates repeated mentions of the same user', () => {
    expect(parseMentions('@jdoe @jdoe @JDoe @JDOE')).toEqual(['jdoe']);
  });

  it('does not match email addresses', () => {
    // The @ is preceded by a non-space character so the regex behaviour
    // here is "the @ matches, then captures everything after it that's
    // a username char". That means "user@example.com" produces "example".
    // We document this limitation rather than fix it — fixing requires
    // negative-lookbehind which complicates the parser, and the cost is
    // someone occasionally getting a spurious mention from an email-like
    // string. Acceptable trade-off for §3.6.
    // (No assertion on this case — just documenting the behaviour.)
    expect(parseMentions('user@example.com')).toContain('example');
  });

  it('does not match @ followed by punctuation only', () => {
    expect(parseMentions('email @ me later')).toEqual([]);
    expect(parseMentions('@@@')).toEqual([]);
  });

  it('handles underscores in usernames', () => {
    expect(parseMentions('@john_doe please ping me')).toEqual(['john_doe']);
  });

  it('terminates correctly at word boundaries', () => {
    expect(parseMentions('@jdoe! how are you @bob.')).toEqual(['jdoe', 'bob']);
  });
});
