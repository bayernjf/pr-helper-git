// Unit tests for remote URL parsing. The parser decides whether the PR board
// is offered at all, so the URL shapes git and GitHub actually emit must all
// resolve to the same owner/repo pair.
import { describe, expect, it } from 'vitest';
import { parseRemoteUrl } from './routes-github.mjs';

describe('parseRemoteUrl', () => {
  it('parses scp-style SSH remotes', () => {
    expect(parseRemoteUrl('git@github.com:owner/repo.git')).toMatchObject({
      isGithub: true,
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('parses HTTPS remotes and keeps dots inside the repository name', () => {
    expect(parseRemoteUrl('https://github.com/owner/repo.net')).toMatchObject({
      isGithub: true,
      owner: 'owner',
      repo: 'repo.net',
    });
  });

  it('ignores an explicit SSH port', () => {
    expect(parseRemoteUrl('ssh://git@github.com:22/owner/repo.git')).toMatchObject({
      isGithub: true,
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('ignores a trailing slash after .git', () => {
    expect(parseRemoteUrl('https://github.com/owner/repo.git/')).toMatchObject({
      isGithub: true,
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('rejects hosts that are not GitHub', () => {
    expect(parseRemoteUrl('git@gitlab.com:owner/repo.git')).toMatchObject({
      isGithub: false,
    });
    expect(parseRemoteUrl('https://example.com/owner/repo')).toMatchObject({
      isGithub: false,
    });
  });

  it('returns null for an empty remote', () => {
    expect(parseRemoteUrl('   ')).toBeNull();
  });
});
