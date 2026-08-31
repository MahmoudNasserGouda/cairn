import { MemoryStore } from './storage';

describe('MemoryStore', () => {
  it('round-trips typed values', async () => {
    const s = new MemoryStore();
    await s.set('profile', { name: 'Ada', skills: ['rust'] });
    expect(await s.get<{ name: string }>('profile')).toEqual({
      name: 'Ada',
      skills: ['rust'],
    });
  });

  it('lists keys by prefix and clears', async () => {
    const s = new MemoryStore();
    await s.set('repo:a', 1);
    await s.set('repo:b', 2);
    await s.set('issue:c', 3);
    expect((await s.keys('repo:')).sort()).toEqual(['repo:a', 'repo:b']);
    await s.delete('repo:a');
    expect(await s.keys('repo:')).toEqual(['repo:b']);
    await s.clear();
    expect(await s.keys()).toEqual([]);
  });
});
