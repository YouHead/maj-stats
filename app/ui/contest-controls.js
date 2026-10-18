const $ = (id) => document.getElementById(id);
export function createContestControls({ post, refresh, onError }) {
  let state, contestId, savedSignature = '', pending = false;
  function render(next) {
    state = next;
    const selected = state.contest.contest_id;
    if (contestId !== selected) { contestId = selected; $('contest-number').value = selected; $('links').value = ''; }
    $('import-contest-id').textContent = `比赛 ${selected}`;
    $('records-count').textContent = `${state.recordCount} 份牌谱`;
    $('change-contest').disabled = state.busy || pending;
    $('contest-number').disabled = state.busy || pending;
    const signature = JSON.stringify(state.savedContests);
    if (signature === savedSignature) return;
    savedSignature = signature;
    $('saved-contests').replaceChildren();
    for (const contest of state.savedContests || []) {
      const option = document.createElement('option'); option.value = contest.contestId;
      option.label = contest.name || `比赛 ${contest.contestId}`; $('saved-contests').append(option);
    }
  }
  $('contest-selector').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!state || state.busy || pending) return;
    pending = true; render(state);
    try { await post('/api/contest/select', { contestId: $('contest-number').value }); await refresh(); }
    catch (error) { onError(error.message); }
    finally { pending = false; render(state); }
  });
  return { render };
}
